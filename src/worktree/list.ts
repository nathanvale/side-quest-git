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

	return {
		branch: entry.branch,
		path: entry.path,
		head: entry.head,
		dirty,
		merged,
		isMain,
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
