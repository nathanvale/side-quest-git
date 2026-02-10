import { spawnAndCollect } from '@side-quest/core/spawn'
import { parseGitStatus as parseGitStatusSummary } from '../git/parse-status.js'

export interface AutoCommitStatus {
	readonly staged: number
	readonly modified: number
	readonly untracked: number
}

/**
 * Parse git status output into change counts for auto-commit logic.
 */
export function parseGitStatusCounts(output: string): AutoCommitStatus {
	return parseGitStatusSummary(output).status
}

/**
 * Get git status for a directory.
 */
export async function getGitStatus(
	cwd: string,
): Promise<AutoCommitStatus | null> {
	const result = await spawnAndCollect(['git', 'status', '--porcelain', '-b'], {
		cwd,
	})
	if (result.exitCode !== 0) {
		return null
	}

	return parseGitStatusCounts(result.stdout)
}

/**
 * Stage tracked changes and create a WIP commit.
 */
export async function createAutoCommit(
	cwd: string,
	message: string,
): Promise<boolean> {
	const addResult = await spawnAndCollect(['git', 'add', '-u'], { cwd })
	if (addResult.exitCode !== 0) {
		return false
	}

	const commitResult = await spawnAndCollect(
		['git', 'commit', '--no-verify', '-m', message],
		{ cwd },
	)
	return commitResult.exitCode === 0
}

/**
 * Print user-facing checkpoint notification.
 */
export function printUserNotification(commitMessage: string): void {
	const subjectLine = commitMessage.split('\n')[0] || commitMessage
	console.log(`✓ WIP checkpoint saved: ${subjectLine}`)
	console.log('  Run /git:commit when ready to finalize')
}
