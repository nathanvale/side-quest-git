import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Check whether a directory is inside a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
	const result = await spawnAndCollect(['git', 'rev-parse', '--git-dir'], {
		cwd,
	})
	return result.exitCode === 0
}
