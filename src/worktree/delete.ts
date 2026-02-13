/**
 * Worktree deletion with safety checks.
 */

import path from 'node:path'
import { shellExec, spawnAndCollect } from '@side-quest/core/spawn'
import { loadOrDetectConfig } from './config.js'
import { detectMergeStatus } from './merge-status.js'
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
}

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

	const detection = await detectMergeStatus(gitRoot, branchName)

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
	}
}

export async function deleteWorktree(
	gitRoot: string,
	branchName: string,
	options: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<DeleteResult> {
	const { config } = loadOrDetectConfig(gitRoot)
	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

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
