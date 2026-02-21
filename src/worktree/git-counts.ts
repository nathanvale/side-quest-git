/**
 * Shared git commit-counting utilities for worktree operations.
 *
 * Why: Both merge-status detection and the status command need ahead/behind
 * counts via `git rev-list --count --left-right`. Extracting to a shared
 * module avoids drift between the two implementations.
 *
 * @module worktree/git-counts
 */

import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Get ahead/behind commit counts between two git refs.
 *
 * Runs `git rev-list --count --left-right <branch>...<base>` and parses
 * the tab-separated output into `{ ahead, behind }`. Returns `{ ahead: 0,
 * behind: 0 }` on any failure (invalid ref, missing upstream, etc.) so
 * callers always get usable numbers.
 *
 * @param gitRoot - Absolute path to the git repository root (used as cwd)
 * @param branch - Branch ref to measure from (plain name or fully-qualified `refs/heads/*`)
 * @param baseBranch - Base branch ref to measure against (plain name or fully-qualified ref)
 * @param signal - Optional AbortSignal to cancel the git subprocess early
 * @returns Ahead and behind commit counts relative to baseBranch
 */
export async function getAheadBehindCounts(
	gitRoot: string,
	branch: string,
	baseBranch: string,
	signal?: AbortSignal,
): Promise<{ ahead: number; behind: number }> {
	const countResult = await spawnAndCollect(
		['git', 'rev-list', '--count', '--left-right', `${branch}...${baseBranch}`],
		{ cwd: gitRoot, signal },
	)

	if (countResult.exitCode !== 0) {
		return { ahead: 0, behind: 0 }
	}

	const parts = countResult.stdout.trim().split('\t')
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return { ahead: 0, behind: 0 }
	}

	const ahead = Number.parseInt(parts[0], 10)
	const behind = Number.parseInt(parts[1], 10)

	return {
		ahead: Number.isNaN(ahead) ? 0 : ahead,
		behind: Number.isNaN(behind) ? 0 : behind,
	}
}
