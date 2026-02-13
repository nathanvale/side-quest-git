/**
 * Shared types for the git worktree CLI.
 *
 * Defines the `.worktrees.json` config schema and all command output types.
 *
 * @module worktree/types
 */

/** Schema for `.worktrees.json` config file at repo root. */
export interface WorktreeConfig {
	/** Directory where worktrees are created, relative to repo root. */
	readonly directory: string
	/** Glob patterns for files/dirs to copy from main worktree. */
	readonly copy: readonly string[]
	/** Directory names to exclude during recursive copy. */
	readonly exclude: readonly string[]
	/** Shell command to run after worktree creation (e.g., "bun install"). */
	readonly postCreate: string | null
	/** Shell command to run before worktree deletion. */
	readonly preDelete: string | null
	/** Branch name template with {type} and {description} placeholders. */
	readonly branchTemplate: string
}

/** Output from `worktree list`. */
export interface WorktreeInfo {
	/** Git branch name. */
	readonly branch: string
	/** Absolute path to the worktree directory. */
	readonly path: string
	/** Short commit SHA at HEAD. */
	readonly head: string
	/** Whether the worktree has uncommitted changes. */
	readonly dirty: boolean
	/** Whether the branch is merged into the main branch. */
	readonly merged: boolean
	/** Whether this is the main (bare) worktree. */
	readonly isMain: boolean
	/** Number of commits ahead of the main branch. */
	readonly commitsAhead?: number
	/** Method by which the branch was integrated (if merged). */
	readonly mergeMethod?: MergeMethod
	/** Status summary string. */
	readonly status?: string
	/** Detection error or warning message. */
	readonly detectionError?: string
}

/** Output from `worktree create`. */
export interface CreateResult {
	/** Branch name that was created/checked out. */
	readonly branch: string
	/** Absolute path to the new worktree. */
	readonly path: string
	/** Number of files copied from the main worktree. */
	readonly filesCopied: number
	/** Output from the postCreate command, if any. */
	readonly postCreateOutput: string | null
	/** Whether the config was auto-detected (no .worktrees.json). */
	readonly configAutoDetected: boolean
	/** Whether the worktree was attached to (re-synced) instead of newly created. */
	readonly attached: boolean
	/** Per-file sync detail when attached to an existing worktree. */
	readonly syncResult?: SyncResult
}

/** Output from `worktree delete`. */
export interface DeleteResult {
	/** Branch name that was removed. */
	readonly branch: string
	/** Path that was removed. */
	readonly path: string
	/** Whether the git branch was also deleted. */
	readonly branchDeleted: boolean
}

/** Output from `worktree install`. */
export interface InstallResult {
	/** Discriminant status of the install operation. */
	readonly status: 'installed' | 'up-to-date' | 'no-package-json' | 'failed'
	/** Name of the detected package manager. */
	readonly packageManager: string | null
	/** Duration of the install in milliseconds. */
	readonly durationMs: number | null
	/** Error message if status is 'failed'. */
	readonly error: string | null
}

/** Detail for a single file during sync. */
export interface SyncedFile {
	/** Path relative to the worktree root. */
	readonly relativePath: string
	/** What happened to this file. */
	readonly action: 'copied' | 'skipped' | 'error'
	/** Why this action was taken. */
	readonly reason?: string
}

/** Output from `worktree sync`. */
export interface SyncResult {
	/** Branch name of the synced worktree. */
	readonly branch: string
	/** Absolute path to the synced worktree. */
	readonly path: string
	/** Number of files that were copied (changed). */
	readonly filesCopied: number
	/** Number of files skipped (identical content). */
	readonly filesSkipped: number
	/** Per-file detail. */
	readonly files: readonly SyncedFile[]
	/** Whether this was a dry run. */
	readonly dryRun: boolean
}

/** Method by which a branch was integrated into the target. */
export type MergeMethod = 'ancestor' | 'squash'

/** Status of an orphan branch relative to the main branch. */
export type OrphanStatus = 'pristine' | 'merged' | 'ahead' | 'unknown'

/** A branch that has no associated worktree. */
export interface OrphanBranch {
	/** Branch name. */
	readonly branch: string
	/** Status relative to main branch. */
	readonly status: OrphanStatus
	/** Number of commits ahead of main (-1 if unknown). */
	readonly commitsAhead: number
	/** Whether the branch is fully merged into main. */
	readonly merged: boolean
	/** Method by which the branch was integrated (if merged). */
	readonly mergeMethod?: MergeMethod
	/** Detection error or warning message. */
	readonly detectionError?: string
}

/** Reason a worktree was skipped during clean. */
export type SkipReason =
	| 'dirty'
	| 'unmerged'
	| 'is-main'
	| 'checked-out-elsewhere'
	| 'delete-failed'

/** A worktree that was successfully cleaned. */
export interface CleanedWorktree {
	/** Branch name that was removed. */
	readonly branch: string
	/** Path that was removed. */
	readonly path: string
	/** Whether the git branch was also deleted. */
	readonly branchDeleted: boolean
	/** Method by which the branch was integrated (if merged). */
	readonly mergeMethod?: MergeMethod
}

/** A worktree that was skipped during clean. */
export interface SkippedWorktree {
	/** Branch name that was skipped. */
	readonly branch: string
	/** Path that was skipped. */
	readonly path: string
	/** Why this worktree was skipped. */
	readonly reason: SkipReason
	/** Error message if reason is 'delete-failed'. */
	readonly error?: string
	/** Method by which the branch was integrated (if merged). */
	readonly mergeMethod?: MergeMethod
}

/** Output from `worktree clean`. */
export interface CleanResult {
	/** Worktrees that were successfully deleted. */
	readonly deleted: readonly CleanedWorktree[]
	/** Worktrees that were skipped. */
	readonly skipped: readonly SkippedWorktree[]
	/** Orphan branches that were deleted (when --include-orphans). */
	readonly orphansDeleted: readonly OrphanBranch[]
	/** Whether this was a dry run. */
	readonly dryRun: boolean
	/** Whether force mode was used. */
	readonly forced: boolean
}

/** Rich status for a worktree including commit info and PR details. */
export interface WorktreeStatus {
	/** Git branch name. */
	readonly branch: string
	/** Absolute path to the worktree directory. */
	readonly path: string
	/** Whether this is the main (bare) worktree. */
	readonly isMain: boolean
	/** Whether the worktree has uncommitted changes. */
	readonly dirty: boolean
	/** Commits ahead of the main branch. */
	readonly commitsAhead: number
	/** Commits behind the main branch. */
	readonly commitsBehind: number
	/** ISO timestamp of the last commit, or null if no commits. */
	readonly lastCommitAt: string | null
	/** Subject line of the last commit, or null if no commits. */
	readonly lastCommitMessage: string | null
	/** Pull request info, or null if not fetched or no PR exists. */
	readonly pr: PullRequestInfo | null
}

/** Pull request info associated with a worktree branch. */
export interface PullRequestInfo {
	/** PR number on the remote. */
	readonly number: number
	/** Current PR status. */
	readonly status: 'open' | 'merged' | 'closed'
	/** URL to the PR on the remote. */
	readonly url: string
}
