import path from 'node:path'
import { emitCliEvent } from '../../../events/emit.js'
import { createWorktree } from '../../create.js'
import { CliError } from '../errors.js'
import { parseBaseRef, parseBooleanFlag } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree create`.
 *
 * Why: Branch creation/attach is the entry-point for new worktree sessions.
 */
export async function handleWorktreeCreate(
	context: CommandContext,
): Promise<CommandResult> {
	const branchName = context.positional[0]
	if (!branchName) {
		throw CliError.usage(
			'Usage: side-quest-git worktree create <branch-name> [--no-install] [--no-fetch] [--no-attach] [--base <ref>]',
		)
	}

	const noInstall = parseBooleanFlag(context.flags, 'no-install')
	const noFetch = parseBooleanFlag(context.flags, 'no-fetch')
	const noAttach = parseBooleanFlag(context.flags, 'no-attach')
	const base = parseBaseRef(context.flags.base)

	const result = await createWorktree(context.gitRoot, branchName, {
		noInstall,
		noFetch,
		attach: !noAttach,
		base,
	})

	void emitCliEvent(
		result.attached ? 'worktree.attached' : 'worktree.created',
		result,
		{
			repo: path.basename(context.gitRoot),
			gitRoot: context.gitRoot,
			source: 'cli',
		},
	)

	return { data: result }
}
