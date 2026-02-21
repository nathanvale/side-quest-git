import path from 'node:path'
import { emitCliEvent } from '../../../events/emit.js'
import { cleanWorktrees } from '../../clean.js'
import { parseBooleanFlag, parseDetectionTimeoutMs } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree clean`.
 *
 * Why: Cleanup is destructive and must consistently parse safety flags.
 */
export async function handleWorktreeClean(
	context: CommandContext,
): Promise<CommandResult> {
	const dryRun = parseBooleanFlag(context.flags, 'dry-run')
	const force = parseBooleanFlag(context.flags, 'force')
	const deleteBranches = parseBooleanFlag(context.flags, 'delete-branches')
	const includeOrphans = parseBooleanFlag(context.flags, 'include-orphans')
	const shallowOk = parseBooleanFlag(context.flags, 'shallow-ok')
	const detectionTimeout = parseDetectionTimeoutMs(context.flags.timeout)

	const result = await cleanWorktrees(context.gitRoot, {
		force,
		dryRun,
		deleteBranches,
		includeOrphans,
		shallowOk,
		detectionTimeout,
	})

	void emitCliEvent('worktree.cleaned', result, {
		repo: path.basename(context.gitRoot),
		gitRoot: context.gitRoot,
		source: 'cli',
	})

	return { data: result }
}
