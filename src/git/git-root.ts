import { resolve } from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Get the main (primary) worktree root directory.
 *
 * Why: For linked worktrees, `getGitRoot()` returns the linked worktree path,
 * not the main repo. This function always returns the main worktree root
 * where the actual `.git` directory (not file) lives.
 *
 * Uses `git rev-parse --git-common-dir` which resolves to the shared
 * `.git` directory for both main and linked worktrees.
 *
 * @param cwd - Directory to resolve from
 * @returns Absolute path to the main worktree root, or null if not in a git repo
 */
export async function getMainRoot(cwd: string): Promise<string | null> {
	const { stdout, exitCode } = await spawnAndCollect(
		['git', 'rev-parse', '--git-common-dir'],
		{ cwd },
	)

	if (exitCode !== 0) return null

	const commonDir = stdout.trim()
	if (!commonDir) return null

	return resolve(cwd, commonDir, '..')
}

/**
 * Get the git repository root for a directory.
 *
 * @deprecated Use `getMainRoot()` for worktree-aware path resolution.
 * This function uses `--show-toplevel` which returns the wrong path in linked worktrees.
 *
 * @param cwd - Directory to resolve from
 * @returns Absolute path to the git root, or null if not in a git repo
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
	const result = await spawnAndCollect(
		['git', 'rev-parse', '--show-toplevel'],
		{
			cwd,
		},
	)

	if (result.exitCode !== 0) {
		return null
	}

	const gitRoot = result.stdout.trim()
	return gitRoot.length > 0 ? gitRoot : null
}
