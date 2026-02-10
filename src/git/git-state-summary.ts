import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Get compact git state text summary used for pre-compact context.
 */
export async function getGitStateSummary(cwd: string): Promise<string> {
	const branchResult = await spawnAndCollect(
		['git', 'branch', '--show-current'],
		{
			cwd,
		},
	)
	const branch =
		branchResult.exitCode === 0
			? branchResult.stdout.trim() || '(detached)'
			: '(detached)'

	const commitsResult = await spawnAndCollect(
		['git', 'log', '--oneline', '--since=1 hour ago'],
		{ cwd },
	)
	const commits =
		commitsResult.exitCode === 0
			? commitsResult.stdout
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
					.slice(0, 10)
			: []

	const statusResult = await spawnAndCollect(['git', 'status', '--porcelain'], {
		cwd,
	})
	const status =
		statusResult.exitCode === 0
			? statusResult.stdout
					.split('\n')
					.map((line) => line.trimEnd())
					.filter(Boolean)
					.slice(0, 20)
			: []

	let summary = `Branch: ${branch}`
	if (commits.length > 0) {
		summary += `\nSession commits:\n${commits.join('\n')}`
	}
	if (status.length > 0) {
		summary += `\nUncommitted:\n${status.join('\n')}`
	}
	return summary
}
