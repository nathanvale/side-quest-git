/**
 * Worktree deletion with safety checks.
 */

import path from 'node:path'
import { shellExec, spawnAndCollect } from '@side-quest/core/spawn'
import { createBackupRef } from './backup.js'
import { loadOrDetectConfig } from './config.js'
import type { DetectionIssue } from './detection-issue.js'
import { checkIsShallow, detectMergeStatus } from './merge-status.js'
import { buildStatusString } from './status-string.js'
import type { DeleteResult, MergeMethod } from './types.js'
import { validateShellCommand } from './validate.js'

export interface DeleteCheck {
	readonly path: string
	readonly branch: string
	readonly dirty: boolean
	readonly merged: boolean
	readonly exists: boolean
	readonly commitsAhead?: number
	readonly mergeMethod?: MergeMethod
	readonly status?: string
	/**
	 * Human-readable detection error or warning message.
	 *
	 * @deprecated Prefer `issues` for structured access.
	 */
	readonly detectionError?: string
	/** Structured detection issues from the merge detection cascade. */
	readonly issues?: readonly DetectionIssue[]
}

/** Options for checkBeforeDelete. */
export interface CheckBeforeDeleteOptions {
	/**
	 * Override the Layer 3 cherry detection timeout in milliseconds.
	 *
	 * Why: Allows callers (e.g. `--timeout` CLI flag) to tune squash detection
	 * per-run without touching env vars. Precedence: this value >
	 * SIDE_QUEST_DETECTION_TIMEOUT_MS env var > default 5000ms.
	 */
	detectionTimeout?: number
	/**
	 * Skip the shallow clone guard during merge detection.
	 *
	 * Why: CI environments often use shallow clones. Pass this when clone depth
	 * is known to be sufficient for the branches under inspection.
	 */
	shallowOk?: boolean
}

/**
 * Check merge and dirty status for a worktree before deletion.
 *
 * Why: Gives callers a non-destructive way to inspect a worktree's state
 * (merged, dirty, commitsAhead, mergeMethod) before deciding whether to
 * call deleteWorktree. Used by the `worktree check` CLI subcommand.
 *
 * @param gitRoot - Main worktree root
 * @param branchName - Branch name of the worktree to check
 * @param options - Options including optional detection timeout override
 * @returns Status snapshot including existence, dirty, merged, and mergeMethod
 */
export async function checkBeforeDelete(
	gitRoot: string,
	branchName: string,
	options: CheckBeforeDeleteOptions = {},
): Promise<DeleteCheck> {
	const { config } = loadOrDetectConfig(gitRoot)
	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

	const existsResult = await spawnAndCollect(
		['git', 'worktree', 'list', '--porcelain'],
		{
			cwd: gitRoot,
		},
	)
	const exists = hasWorktreePath(existsResult.stdout, worktreePath)

	if (!exists) {
		return {
			path: worktreePath,
			branch: branchName,
			dirty: false,
			merged: false,
			exists: false,
		}
	}

	const statusResult = await spawnAndCollect(['git', 'status', '--porcelain'], {
		cwd: worktreePath,
	})
	const dirty =
		statusResult.exitCode === 0 && statusResult.stdout.trim().length > 0

	const isShallow =
		process.env.SIDE_QUEST_NO_DETECTION === '1'
			? null
			: await checkIsShallow(gitRoot)
	const detection = await detectMergeStatus(gitRoot, branchName, undefined, {
		isShallow,
		...(options.detectionTimeout !== undefined
			? { timeout: options.detectionTimeout }
			: {}),
		...(options.shallowOk !== undefined
			? { shallowOk: options.shallowOk }
			: {}),
	})

	const status = buildStatusString({
		merged: detection.merged,
		dirty,
		commitsAhead: detection.commitsAhead,
		commitsBehind: detection.commitsBehind,
		mergeMethod: detection.mergeMethod,
	})

	return {
		path: worktreePath,
		branch: branchName,
		dirty,
		merged: detection.merged,
		exists,
		commitsAhead: detection.commitsAhead,
		mergeMethod: detection.mergeMethod,
		status,
		...(detection.detectionError !== undefined
			? { detectionError: detection.detectionError }
			: {}),
		...(detection.issues !== undefined ? { issues: detection.issues } : {}),
	}
}

/**
 * Delete a worktree by branch name.
 *
 * Why: Runs merge detection before removal so the `worktree.deleted` event
 * payload carries `mergeMethod`, enabling downstream consumers (dashboards,
 * audit logs) to know how the branch was integrated without a separate check.
 *
 * @param gitRoot - Main worktree root
 * @param branchName - Branch name of the worktree to delete
 * @param options - Deletion options (force, deleteBranch, shallowOk, detectionTimeout)
 * @returns Delete result with branch, path, branchDeleted, and mergeMethod
 */
export async function deleteWorktree(
	gitRoot: string,
	branchName: string,
	options: {
		force?: boolean
		deleteBranch?: boolean
		/**
		 * Skip the shallow clone guard during merge detection.
		 *
		 * Why: CI environments often use shallow clones. Pass this when clone depth
		 * is known to be sufficient for the branches under inspection.
		 */
		shallowOk?: boolean
		/**
		 * Override the Layer 3 cherry detection timeout in milliseconds.
		 *
		 * Why: Allows callers to tune squash detection per-run without touching
		 * env vars. Precedence: this value > SIDE_QUEST_DETECTION_TIMEOUT_MS > 5000ms.
		 */
		detectionTimeout?: number
	} = {},
): Promise<DeleteResult> {
	const { config } = loadOrDetectConfig(gitRoot)
	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

	// Detect merge status before removal so mergeMethod is available in the
	// event payload. Wrapped in try/catch: detection failure must never block
	// the delete operation -- log a warning and proceed with undefined.
	let detection: Awaited<ReturnType<typeof detectMergeStatus>> | undefined
	try {
		const isShallow =
			process.env.SIDE_QUEST_NO_DETECTION === '1'
				? null
				: await checkIsShallow(gitRoot)
		detection = await detectMergeStatus(gitRoot, branchName, undefined, {
			isShallow,
			...(options.shallowOk !== undefined
				? { shallowOk: options.shallowOk }
				: {}),
			...(options.detectionTimeout !== undefined
				? { timeout: options.detectionTimeout }
				: {}),
		})
	} catch (err) {
		// Detection failure is non-fatal: log a warning but proceed with deletion.
		// This prevents a broken git state from locking out the delete command.
		const msg = err instanceof Error ? err.message : String(err)
		console.error(
			JSON.stringify({
				warning: `merge detection failed before delete: ${msg}`,
			}),
		)
	}

	if (config.preDelete) {
		await runPreDelete(config.preDelete, worktreePath)
	}

	const removeArgs = ['git', 'worktree', 'remove', worktreePath]
	if (options.force) {
		removeArgs.push('--force')
	}

	const removeResult = await spawnAndCollect(removeArgs, { cwd: gitRoot })
	if (removeResult.exitCode !== 0) {
		throw new Error(`Failed to remove worktree: ${removeResult.stderr.trim()}`)
	}

	await spawnAndCollect(['git', 'worktree', 'prune'], { cwd: gitRoot })

	let branchDeleted = false
	if (options.deleteBranch) {
		// Best-effort backup before deletion -- never fail the delete if backup fails.
		// This gives operators a recovery path via `worktree recover <branch>`.
		try {
			await createBackupRef(gitRoot, branchName)
		} catch {
			// Silently swallow -- backup failure must not block the delete.
		}

		const deleteFlag = options.force ? '-D' : '-d'
		const branchResult = await spawnAndCollect(
			['git', 'branch', deleteFlag, branchName],
			{ cwd: gitRoot },
		)
		branchDeleted = branchResult.exitCode === 0
	}

	return {
		branch: branchName,
		path: worktreePath,
		branchDeleted,
		...(detection?.mergeMethod !== undefined
			? { mergeMethod: detection.mergeMethod }
			: {}),
	}
}

async function runPreDelete(command: string, cwd: string): Promise<void> {
	validateShellCommand(command)
	const result = await shellExec(command, { cwd, throws: false })
	if (result.exitCode !== 0) {
		throw new Error(
			`preDelete command failed (${command}): ${result.stderr.trim()}`,
		)
	}
}

/**
 * Check whether porcelain output contains an exact worktree path entry.
 *
 * Why: substring checks can false-positive on prefix collisions such as
 * `/repo/.worktrees/feat-foo` vs `/repo/.worktrees/feat-foobar`.
 */
function hasWorktreePath(porcelainOutput: string, targetPath: string): boolean {
	for (const line of porcelainOutput.split('\n')) {
		if (!line.startsWith('worktree ')) continue
		if (line.slice('worktree '.length).trim() === targetPath) return true
	}
	return false
}
