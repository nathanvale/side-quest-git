import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Get git repository root for a directory.
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
