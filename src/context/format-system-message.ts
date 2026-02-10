import type { GitContext } from './types.js'

/**
 * Format compact system message for SessionStart.
 */
export function formatSystemMessage(context: GitContext): string {
	const { branch, status, recentCommits } = context
	const totalChanges = status.staged + status.modified + status.untracked
	const changesSuffix = totalChanges > 0 ? `, ${totalChanges} changes` : ''
	const lastCommit =
		recentCommits[0]?.split(' ').slice(1).join(' ') || 'no commits'

	return `Git: ${branch}${changesSuffix} | Last: ${lastCommit} | /git:commit /git:squash /git:checkpoint`
}
