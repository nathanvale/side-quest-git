import type { GitStatus } from '../git/types.js'

/** Git context snapshot used by SessionStart messaging. */
export interface GitContext {
	readonly branch: string
	readonly status: GitStatus
	readonly recentCommits: readonly string[]
}
