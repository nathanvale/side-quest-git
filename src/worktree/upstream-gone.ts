/**
 * Upstream tracking ref gone detection.
 *
 * Detects when a branch's remote tracking ref has been deleted -- the typical
 * state after a PR is merged on GitHub and the remote branch is auto-deleted.
 * This is a lightweight single git call that complements merge detection.
 *
 * @module worktree/upstream-gone
 */

import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Check if a branch's remote tracking ref has been deleted.
 *
 * Runs `git for-each-ref --format='%(upstream:track)' refs/heads/<branch>`.
 * When the upstream tracking ref no longer exists on the remote, git reports
 * `[gone]` in the tracking field. This is the canonical signal that a remote
 * branch was deleted (e.g. after PR merge with "delete branch" on GitHub).
 *
 * Returns `false` -- not `undefined` -- for branches with no upstream
 * configured, because the absence of an upstream is not the same as an
 * upstream that is gone. Callers that want to distinguish these cases should
 * check the raw git output themselves.
 *
 * @param gitRoot - Absolute path to the git repository root
 * @param branch - Local branch name to check (plain name, not a full ref)
 * @returns `true` if the upstream tracking ref has been deleted, `false` otherwise
 */
export async function checkUpstreamGone(
	gitRoot: string,
	branch: string,
): Promise<boolean> {
	// Bail out early for synthetic/special branch names that cannot have an upstream.
	if (!branch || branch === '(detached)') {
		return false
	}

	const result = await spawnAndCollect(
		[
			'git',
			'for-each-ref',
			`--format=%(upstream:track)`,
			`refs/heads/${branch}`,
		],
		{ cwd: gitRoot },
	)

	if (result.exitCode !== 0) {
		// If git failed (e.g. invalid ref, corrupt repo), treat as not-gone.
		// Fail-open: callers should not block on an ambiguous upstream state.
		return false
	}

	const output = result.stdout.trim()
	// git outputs "[gone]" when the upstream branch no longer exists on the remote.
	// Match as a substring to handle combined states like "[ahead 1, gone]" if
	// a future git version ever emits them, though today git only emits "[gone]".
	return output.includes('[gone]')
}
