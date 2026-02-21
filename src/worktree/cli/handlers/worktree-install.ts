import path from 'node:path'
import { emitCliEvent } from '../../../events/emit.js'
import { runInstall } from '../../install.js'
import { CliError } from '../errors.js'
import { parseBooleanFlag } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree install`.
 *
 * Why: Keeps install execution and telemetry behavior uniform.
 */
export async function handleWorktreeInstall(
	context: CommandContext,
): Promise<CommandResult> {
	const targetPath = context.positional[0]
	if (!targetPath) {
		throw CliError.usage(
			'Usage: side-quest-git worktree install <path> [--force]',
		)
	}

	const force = parseBooleanFlag(context.flags, 'force')
	const result = await runInstall(
		path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath),
		{ force },
	)

	void emitCliEvent('worktree.installed', result, {
		repo: path.basename(context.gitRoot),
		gitRoot: context.gitRoot,
		source: 'cli',
	})

	return { data: result }
}
