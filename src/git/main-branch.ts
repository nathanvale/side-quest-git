import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Determine the repository's main branch name.
 */
export async function getMainBranch(gitRoot: string): Promise<string> {
	const mainResult = await spawnAndCollect(
		['git', 'rev-parse', '--verify', 'main'],
		{ cwd: gitRoot },
	)
	if (mainResult.exitCode === 0) {
		return 'main'
	}

	const masterResult = await spawnAndCollect(
		['git', 'rev-parse', '--verify', 'master'],
		{ cwd: gitRoot },
	)
	if (masterResult.exitCode === 0) {
		return 'master'
	}

	const headResult = await spawnAndCollect(
		['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
		{ cwd: gitRoot },
	)

	return headResult.stdout.trim() || 'main'
}
