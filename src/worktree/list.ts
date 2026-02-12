/**
 * Worktree listing with status enrichment.
 */

import { spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import type { WorktreeInfo } from './types.js'

export async function listWorktrees(gitRoot: string): Promise<WorktreeInfo[]> {
	const result = await spawnAndCollect(
		['git', 'worktree', 'list', '--porcelain'],
		{
			cwd: gitRoot,
		},
	)
	if (result.exitCode !== 0) {
		throw new Error(`Failed to list worktrees: ${result.stderr.trim()}`)
	}

	const entries = parsePorcelainOutput(result.stdout)
	const mainBranch = await getMainBranch(gitRoot)

	return Promise.all(
		entries.map((entry) => enrichWorktreeInfo(entry, mainBranch)),
	)
}

interface RawWorktreeEntry {
	path: string
	head: string
	branch: string
	isBare: boolean
}

function parsePorcelainOutput(output: string): RawWorktreeEntry[] {
	const entries: RawWorktreeEntry[] = []
	const blocks = output.trim().split('\n\n')

	for (const block of blocks) {
		if (!block.trim()) {
			continue
		}

		const lines = block.trim().split('\n')
		let entryPath = ''
		let head = ''
		let branch = ''
		let isBare = false

		for (const line of lines) {
			if (line.startsWith('worktree ')) {
				entryPath = line.slice('worktree '.length)
			} else if (line.startsWith('HEAD ')) {
				head = line.slice('HEAD '.length).slice(0, 7)
			} else if (line.startsWith('branch ')) {
				branch = line.slice('branch '.length).replace('refs/heads/', '')
			} else if (line === 'bare') {
				isBare = true
			} else if (line === 'detached') {
				branch = '(detached)'
			}
		}

		if (entryPath) {
			entries.push({ path: entryPath, head, branch, isBare })
		}
	}

	return entries
}

async function enrichWorktreeInfo(
	entry: RawWorktreeEntry,
	mainBranch: string,
): Promise<WorktreeInfo> {
	const isMain =
		entry.isBare ||
		entry.branch === mainBranch ||
		entry.branch === 'main' ||
		entry.branch === 'master'

	const dirty = await isDirty(entry.path)
	const merged = isMain
		? true
		: await isMerged(entry.path, entry.branch, mainBranch)

	// Compute commits ahead (lightweight)
	let commitsAhead: number | undefined
	let status: string | undefined

	if (!isMain && entry.branch !== '(detached)') {
		try {
			const countResult = await spawnAndCollect(
				['git', 'rev-list', '--count', `${mainBranch}..${entry.branch}`],
				{ cwd: entry.path },
			)
			if (countResult.exitCode === 0) {
				commitsAhead = Number.parseInt(countResult.stdout.trim(), 10)

				// Compute status string
				// To distinguish between "merged" and "pristine", check if main has moved forward
				// If merged = true and main has commits this branch doesn't have, it's "merged"
				// If merged = true and main is at the same point, it's "pristine"
				if (merged && commitsAhead === 0) {
					const behindResult = await spawnAndCollect(
						['git', 'rev-list', '--count', `${entry.branch}..${mainBranch}`],
						{ cwd: entry.path },
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
	}

	return {
		branch: entry.branch,
		path: entry.path,
		head: entry.head,
		dirty,
		merged,
		isMain,
		commitsAhead,
		status,
	}
}

async function isDirty(worktreePath: string): Promise<boolean> {
	const result = await spawnAndCollect(['git', 'status', '--porcelain'], {
		cwd: worktreePath,
	})
	return result.exitCode === 0 && result.stdout.trim().length > 0
}

async function isMerged(
	worktreePath: string,
	branch: string,
	mainBranch: string,
): Promise<boolean> {
	if (branch === '(detached)') {
		return false
	}

	const result = await spawnAndCollect(
		['git', 'merge-base', '--is-ancestor', branch, mainBranch],
		{ cwd: worktreePath },
	)
	return result.exitCode === 0
}
