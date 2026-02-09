import { spawnAndCollect } from '@side-quest/core/spawn'
import { isGitRepo } from '../git/is-git-repo.js'
import { parseGitStatus } from '../git/parse-status.js'
import type { GitContext } from './types.js'

/**
 * Load current git context for a directory.
 */
export async function getGitContext(cwd: string): Promise<GitContext | null> {
	if (!(await isGitRepo(cwd))) {
		return null
	}

	const statusResult = await spawnAndCollect(
		['git', 'status', '--porcelain', '-b'],
		{
			cwd,
		},
	)
	if (statusResult.exitCode !== 0) {
		return null
	}

	const parsedStatus = parseGitStatus(statusResult.stdout)

	const commitsResult = await spawnAndCollect(
		['git', 'log', '--oneline', '-5', '--format=%h %s (%ar)'],
		{ cwd },
	)
	const recentCommits =
		commitsResult.exitCode === 0
			? commitsResult.stdout
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			: []

	return {
		branch: parsedStatus.branch || '(detached)',
		status: parsedStatus.status,
		recentCommits,
	}
}
