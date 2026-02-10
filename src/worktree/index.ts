/**
 * Worktree module exports.
 */

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
export { detectInstallCommand } from './detect-pm.js'
export { listWorktrees } from './list.js'
export type {
	CreateResult,
	DeleteResult,
	WorktreeConfig,
	WorktreeInfo,
} from './types.js'
