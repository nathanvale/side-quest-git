import path from 'node:path'
import { emitCliEvent } from '../../../events/emit.js'
import { deleteWorktree } from '../../delete.js'
import { CliError } from '../errors.js'
import { parseBooleanFlag } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree delete`.
 *
 * Why: Deletion is destructive, so parsing and event emission are centralized.
 */
export async function handleWorktreeDelete(
	context: CommandContext,
): Promise<CommandResult> {
	const branchName = context.positional[0]
	if (!branchName) {
		throw CliError.usage(
			'Usage: side-quest-git worktree delete <branch-name> [--force] [--delete-branch]',
		)
	}

	const force = parseBooleanFlag(context.flags, 'force')
	const deleteBranch = parseBooleanFlag(context.flags, 'delete-branch')

	const result = await deleteWorktree(context.gitRoot, branchName, {
		force,
		deleteBranch,
	})

	void emitCliEvent('worktree.deleted', result, {
		repo: path.basename(context.gitRoot),
		gitRoot: context.gitRoot,
		source: 'cli',
	})

	return { data: result }
}
