import type { GitContext } from './types.js'

/**
 * Format expanded git context for additionalContext output.
 */
export function formatContext(context: GitContext): string {
	const { branch, status, recentCommits } = context

	let output = 'Git Context:\n'
	output += `  Branch: ${branch}\n`
	output += `  Status: ${status.staged} staged, ${status.modified} modified, ${status.untracked} untracked\n`
	output += '\nRecent commits:\n'

	if (recentCommits.length > 0) {
		for (const commit of recentCommits) {
			output += `  ${commit}\n`
		}
	} else {
		output += '  (no commits yet)\n'
	}

	output += '\nGit workflow: /git:commit, /git:squash, /git:checkpoint'
	output +=
		'\ngit-expert skill handles: commits, PRs, history, worktrees, changelog, branch compare, squash, safety guards'

	return output
}
