export interface CommitDetectionResult {
	readonly isCommit: boolean
	readonly isWip: boolean
}

/**
 * Detect `git commit` and whether it is a WIP checkpoint (`--no-verify`).
 */
export function isCommitCommand(command: string): CommitDetectionResult {
	const commitPattern = /(?:^|&&\s*|;\s*)git\s+commit(?:\s|$)/
	const isCommit = commitPattern.test(command)

	if (!isCommit) {
		return { isCommit: false, isWip: false }
	}

	return {
		isCommit: true,
		isWip: command.includes('--no-verify'),
	}
}
