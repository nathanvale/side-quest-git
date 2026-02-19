/**
 * Worktree module exports.
 */

export {
	type BackupRef,
	cleanupBackupRefs,
	createBackupRef,
	listBackupRefs,
	restoreBackupRef,
} from './backup.js'
export { type CleanOptions, cleanWorktrees } from './clean.js'
export {
	autoDetectConfig,
	CONFIG_FILENAME,
	DEFAULT_EXCLUDES,
	loadConfig,
	loadOrDetectConfig,
	writeConfig,
} from './config.js'
export { copyWorktreeFiles } from './copy-files.js'
export { createWorktree } from './create.js'
export {
	checkBeforeDelete,
	type DeleteCheck,
	deleteWorktree,
} from './delete.js'
export {
	detectInstallCommand,
	detectLockfile,
	detectPackageManager,
} from './detect-pm.js'
export {
	createDetectionIssue,
	DETECTION_CODES,
	type DetectionIssue,
} from './detection-issue.js'
export { getAheadBehindCounts } from './git-counts.js'
export { runInstall, shouldRunInstall } from './install.js'
export { listWorktrees } from './list.js'
export { getWorktreeBranches, listOrphanBranches } from './orphans.js'
export type { StatusOptions } from './status.js'
export { getWorktreeStatus } from './status.js'
export { buildStatusString, type StatusInput } from './status-string.js'
export { syncAllWorktrees, syncWorktree } from './sync.js'
export type {
	CleanedWorktree,
	CleanResult,
	CreateResult,
	DeleteResult,
	InstallResult,
	MergeMethod,
	OrphanBranch,
	OrphanStatus,
	PullRequestInfo,
	SkippedWorktree,
	SkipReason,
	SyncedFile,
	SyncResult,
	WorktreeConfig,
	WorktreeInfo,
	WorktreeStatus,
} from './types.js'
export { checkUpstreamGone } from './upstream-gone.js'
export type { WatchOptions } from './watch.js'
export { watchWorktreeStatus } from './watch.js'
