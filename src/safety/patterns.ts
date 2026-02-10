/**
 * Shared safety patterns used by git hooks and library consumers.
 */

export interface SafetyPattern {
	readonly pattern: RegExp
	readonly reason: string
}

/** Branches where direct non-WIP commits are blocked. */
export const PROTECTED_BRANCHES = ['main', 'master'] as const

/** Protected file patterns for Write/Edit tools. */
export const PROTECTED_FILE_PATTERNS: readonly SafetyPattern[] = [
	{
		pattern: /\.env($|\.)/,
		reason: '.env files may contain secrets.',
	},
	{
		pattern: /credentials/,
		reason: 'Credential files should not be modified by agents.',
	},
	{
		pattern: /\.git\//,
		reason: 'Direct .git directory modifications are dangerous.',
	},
]

/** Destructive git command patterns that should be blocked. */
export const BLOCKED_PATTERNS: readonly SafetyPattern[] = [
	{
		pattern: /git\s+push\s+.*(?:--force|-f)(?:\s|$)/,
		reason:
			'Force push can destroy remote history. Use --force-with-lease if you must.',
	},
	{
		pattern: /git\s+reset\s+--hard/,
		reason: 'Hard reset destroys uncommitted changes permanently.',
	},
	{
		pattern: /git\s+clean\s+.*-f/,
		reason: 'git clean -f permanently deletes untracked files.',
	},
	{
		pattern: /git\s+checkout\s+\.\s*$/,
		reason: 'git checkout . discards all unstaged changes permanently.',
	},
	{
		pattern: /git\s+restore\s+\.\s*$/,
		reason: 'git restore . discards all unstaged changes permanently.',
	},
	{
		pattern: /git\s+branch\s+.*-D\s/,
		reason: 'git branch -D force-deletes a branch even if not merged.',
	},
]
