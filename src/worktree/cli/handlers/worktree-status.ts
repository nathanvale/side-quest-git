import { getWorktreeStatus } from '../../status.js'
import { watchWorktreeStatus } from '../../watch.js'
import { CliError } from '../errors.js'
import { parseBooleanFlag, parseWatchIntervalMs } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree status`.
 *
 * Why: Status supports snapshot and long-running watch modes.
 */
export async function handleWorktreeStatus(
	context: CommandContext,
): Promise<CommandResult> {
	const includePr = parseBooleanFlag(context.flags, 'pr')
	const watch = parseBooleanFlag(context.flags, 'watch')

	if (watch) {
		const interval = parseWatchIntervalMs(context.flags.interval)
		if (context.nonInteractive) {
			throw CliError.usage('--watch requires an interactive terminal (TTY)')
		}
		await watchWorktreeStatus(context.gitRoot, {
			interval,
			includePr,
		})
		return { data: { watching: true } }
	}

	const statuses = await getWorktreeStatus(context.gitRoot, {
		includePr,
	})
	return { data: statuses }
}
