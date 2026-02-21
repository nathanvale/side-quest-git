import path from 'node:path'
import { emitCliEvent } from '../../../events/emit.js'
import { syncAllWorktrees, syncWorktree } from '../../sync.js'
import { CliError } from '../errors.js'
import { parseBooleanFlag } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree sync`.
 *
 * Why: Sync supports both single-branch and all-worktree modes,
 * which need consistent validation and event emission.
 */
export async function handleWorktreeSync(
	context: CommandContext,
): Promise<CommandResult> {
	const branchOrAll = context.positional[0]
	const dryRun = parseBooleanFlag(context.flags, 'dry-run')
	const all = parseBooleanFlag(context.flags, 'all') || branchOrAll === '--all'

	if (all) {
		const result = await syncAllWorktrees(context.gitRoot, { dryRun })
		void emitCliEvent('worktree.synced', result, {
			repo: path.basename(context.gitRoot),
			gitRoot: context.gitRoot,
			source: 'cli',
		})
		return { data: result }
	}

	if (!branchOrAll) {
		throw CliError.usage(
			'Usage: side-quest-git worktree sync <branch> [--dry-run] or side-quest-git worktree sync --all [--dry-run]',
		)
	}

	const result = await syncWorktree(context.gitRoot, branchOrAll, { dryRun })
	void emitCliEvent('worktree.synced', result, {
		repo: path.basename(context.gitRoot),
		gitRoot: context.gitRoot,
		source: 'cli',
	})
	return { data: result }
}
