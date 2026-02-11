/**
 * Enhanced worktree status with commit info and PR details.
 *
 * Enriches the basic worktree listing with ahead/behind counts,
 * last commit info, and optional pull request status from GitHub.
 *
 * @module worktree/status
 */

import { processInParallelChunks } from '@side-quest/core/concurrency'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { safeJsonParse } from '@side-quest/core/utils'
import { getMainBranch } from '../git/main-branch.js'
import { listWorktrees } from './list.js'
import type { PullRequestInfo, WorktreeStatus } from './types.js'

/** Options for the enhanced status command. */
export interface StatusOptions {
	/** Whether to fetch PR info from GitHub via `gh`. */
	readonly includePr?: boolean
	/** Max worktrees to process in parallel (default: 4). */
	readonly concurrency?: number
}

/**
 * Get rich status for all worktrees including commit info and optional PR details.
 *
 * Why: Provides a single-call overview of all worktrees with commits
 * ahead/behind and PR status, using bounded concurrency to avoid
 * hammering git/GitHub APIs.
 */
export async function getWorktreeStatus(
	gitRoot: string,
	options: StatusOptions = {},
): Promise<readonly WorktreeStatus[]> {
	const worktrees = await listWorktrees(gitRoot)
	const mainBranch = await getMainBranch(gitRoot)
	const { concurrency = 4, includePr = false } = options

	return processInParallelChunks({
		items: [...worktrees],
		chunkSize: concurrency,
		processor: async (wt) => {
			const [aheadBehind, lastCommit, pr] = await Promise.all([
				getAheadBehind(wt.path, wt.branch, wt.isMain, mainBranch),
				getLastCommit(wt.path),
				includePr ? getPrInfo(wt.branch, gitRoot) : Promise.resolve(null),
			])

			return {
				branch: wt.branch,
				path: wt.path,
				isMain: wt.isMain,
				dirty: wt.dirty,
				commitsAhead: aheadBehind.ahead,
				commitsBehind: aheadBehind.behind,
				lastCommitAt: lastCommit.at,
				lastCommitMessage: lastCommit.message,
				pr,
			} satisfies WorktreeStatus
		},
	})
}

interface AheadBehind {
	readonly ahead: number
	readonly behind: number
}

/**
 * Count commits ahead/behind between a branch and main.
 *
 * Uses `git rev-list --count --left-right` to get both counts in a
 * single call. Returns zeros for main branches or on any failure
 * (e.g., no upstream tracking).
 */
async function getAheadBehind(
	worktreePath: string,
	branch: string,
	isMain: boolean,
	mainBranch: string,
): Promise<AheadBehind> {
	if (isMain || branch === '(detached)') {
		return { ahead: 0, behind: 0 }
	}

	const result = await spawnAndCollect(
		['git', 'rev-list', '--count', '--left-right', `${branch}...${mainBranch}`],
		{ cwd: worktreePath },
	)

	if (result.exitCode !== 0) {
		return { ahead: 0, behind: 0 }
	}

	const parts = result.stdout.trim().split('\t')
	if (parts.length !== 2) {
		return { ahead: 0, behind: 0 }
	}

	return {
		ahead: Number.parseInt(parts[0]!, 10) || 0,
		behind: Number.parseInt(parts[1]!, 10) || 0,
	}
}

interface LastCommit {
	readonly at: string | null
	readonly message: string | null
}

/**
 * Get the ISO timestamp and subject of the last commit in a worktree.
 *
 * Uses `git log -1 --format=%aI%n%s` to fetch author date (ISO 8601)
 * and subject in a single call. Returns nulls on failure (empty repo, etc.).
 */
async function getLastCommit(worktreePath: string): Promise<LastCommit> {
	const result = await spawnAndCollect(
		['git', 'log', '-1', '--format=%aI%n%s'],
		{ cwd: worktreePath },
	)

	if (result.exitCode !== 0) {
		return { at: null, message: null }
	}

	const lines = result.stdout.trim().split('\n')
	if (lines.length < 2) {
		return { at: null, message: null }
	}

	return {
		at: lines[0]!,
		message: lines[1]!,
	}
}

/**
 * Fetch PR info for a branch from GitHub via the `gh` CLI.
 *
 * Returns null on any failure -- gh not installed, auth failure,
 * no PR for this branch, or rate limiting. This is intentionally
 * best-effort so the status command never fails due to GitHub issues.
 */
async function getPrInfo(
	branch: string,
	gitRoot: string,
): Promise<PullRequestInfo | null> {
	const result = await spawnAndCollect(
		['gh', 'pr', 'view', branch, '--json', 'number,state,url'],
		{ cwd: gitRoot },
	)

	if (result.exitCode !== 0) {
		return null
	}

	const parsed = safeJsonParse<{
		number?: number
		state?: string
		url?: string
	} | null>(result.stdout.trim(), null)

	if (!parsed || typeof parsed.number !== 'number' || !parsed.url) {
		return null
	}

	const stateMap: Record<string, PullRequestInfo['status']> = {
		OPEN: 'open',
		MERGED: 'merged',
		CLOSED: 'closed',
	}

	const status = stateMap[parsed.state ?? '']
	if (!status) {
		return null
	}

	return {
		number: parsed.number,
		status,
		url: parsed.url,
	}
}
