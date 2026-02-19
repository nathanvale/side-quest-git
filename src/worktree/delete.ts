/**
 * Worktree deletion with safety checks.
 */

import path from 'node:path'
import { shellExec, spawnAndCollect } from '@side-quest/core/spawn'
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

/**
 * Check merge and dirty status for a worktree before deletion.
 *
 * Why: Gives callers a non-destructive way to inspect a worktree's state
 * (merged, dirty, commitsAhead, mergeMethod) before deciding whether to
 * call deleteWorktree. Used by the `worktree check` CLI subcommand.
 *
 * @param gitRoot - Main worktree root
 * @param branchName - Branch name of the worktree to check
 * @returns Status snapshot including existence, dirty, merged, and mergeMethod
 */
export async function checkBeforeDelete(
	gitRoot: string,
	branchName: string,
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
	const exists = existsResult.stdout.includes(worktreePath)

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

	const isShallow = await checkIsShallow(gitRoot)
	const detection = await detectMergeStatus(gitRoot, branchName, undefined, {
		isShallow,
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
 * @param options - Deletion options (force, deleteBranch)
 * @returns Delete result with branch, path, branchDeleted, and mergeMethod
 */
export async function deleteWorktree(
	gitRoot: string,
	branchName: string,
	options: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<DeleteResult> {
	const { config } = loadOrDetectConfig(gitRoot)
	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

	// Detect merge status before removal so mergeMethod is available in the
	// event payload. Best-effort: if detection fails we proceed with undefined.
	const isShallow = await checkIsShallow(gitRoot)
	const detection = await detectMergeStatus(gitRoot, branchName, undefined, {
		isShallow,
	})

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
		...(detection.mergeMethod !== undefined
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
