/** Structured git status counts. */
export interface GitStatus {
	readonly staged: number
	readonly modified: number
	readonly untracked: number
}

/** Parsed `git status --porcelain -b` output. */
export interface ParsedGitStatus {
	readonly branch: string
	readonly status: GitStatus
}
