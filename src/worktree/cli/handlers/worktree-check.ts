import { checkBeforeDelete } from '../../delete.js'
import { CliError } from '../errors.js'
import { parseBooleanFlag, parseDetectionTimeoutMs } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree check`.
 *
 * Why: This command provides a non-destructive pre-delete safety snapshot.
 */
export async function handleWorktreeCheck(
	context: CommandContext,
): Promise<CommandResult> {
	const branchName = context.positional[0]
	if (!branchName) {
		throw CliError.usage(
			'Usage: side-quest-git worktree check <branch-name> [--timeout <ms>] [--shallow-ok]',
		)
	}

	const shallowOk = parseBooleanFlag(context.flags, 'shallow-ok')
	const detectionTimeout = parseDetectionTimeoutMs(context.flags.timeout)

	const result = await checkBeforeDelete(context.gitRoot, branchName, {
		detectionTimeout,
		shallowOk,
	})

	return { data: result }
}
