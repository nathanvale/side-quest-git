/**
 * Worktree deletion with safety checks.
 */

import path from 'node:path'
import { shellExec, spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import { loadOrDetectConfig } from './config.js'
import type { DeleteResult } from './types.js'
import { validateShellCommand } from './validate.js'

export interface DeleteCheck {
	readonly path: string
	readonly branch: string
	readonly dirty: boolean
	readonly merged: boolean
	readonly exists: boolean
	readonly commitsAhead?: number
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

	const mainBranch = await getMainBranch(gitRoot)
	const mergeResult = await spawnAndCollect(
		['git', 'merge-base', '--is-ancestor', branchName, mainBranch],
		{ cwd: gitRoot },
	)
	const merged = mergeResult.exitCode === 0

	// Compute commits ahead (lightweight)
	let commitsAhead: number | undefined
	let status: string | undefined

	try {
		const countResult = await spawnAndCollect(
			['git', 'rev-list', '--count', `${mainBranch}..${branchName}`],
			{ cwd: worktreePath },
		)
		if (countResult.exitCode === 0) {
			commitsAhead = Number.parseInt(countResult.stdout.trim(), 10)

			// Compute status string
			// To distinguish between "merged" and "pristine", check if main has moved forward
			// If merged = true and main has commits this branch doesn't have, it's "merged"
			// If merged = true and main is at the same point, it's "pristine"
			if (merged && commitsAhead === 0) {
				const behindResult = await spawnAndCollect(
					['git', 'rev-list', '--count', `${branchName}..${mainBranch}`],
					{ cwd: worktreePath },
				)
				const commitsBehind =
					behindResult.exitCode === 0
						? Number.parseInt(behindResult.stdout.trim(), 10)
						: 0

				if (commitsBehind > 0) {
					// Main has moved forward, so this branch is behind (merged or just old)
					status = 'merged'
				} else if (dirty) {
					// At same point as main, but has uncommitted changes
					status = 'dirty'
				} else {
					// At same point as main, no changes - pristine
					status = 'pristine'
				}
			} else if (commitsAhead > 0 && dirty) {
				status = `${commitsAhead} ahead, dirty`
			} else if (commitsAhead > 0) {
				status = `${commitsAhead} ahead`
			} else if (dirty) {
				status = 'dirty'
			} else {
				status = 'pristine'
			}
		} else {
			status = 'unknown'
		}
	} catch {
		status = 'unknown'
	}

	return {
		path: worktreePath,
		branch: branchName,
		dirty,
		merged,
		exists,
		commitsAhead,
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
