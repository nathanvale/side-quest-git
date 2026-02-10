import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Get current branch name or null for detached/non-repo states.
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
	const result = await spawnAndCollect(['git', 'branch', '--show-current'], {
		cwd,
	})
	if (result.exitCode !== 0) {
		return null
	}

	const branch = result.stdout.trim()
	return branch.length > 0 ? branch : null
}
