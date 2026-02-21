import { computeOrphanHealth } from '../../list-health.js'
import { listOrphanBranches } from '../../orphans.js'
import { EXIT_RUNTIME } from '../exit-codes.js'
import { parseBooleanFlag, parseDetectionTimeoutMs } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree orphans`.
 *
 * Why: Returns orphan analysis plus health signal for systemic failures.
 */
export async function handleWorktreeOrphans(
	context: CommandContext,
): Promise<CommandResult> {
	const shallowOk = parseBooleanFlag(context.flags, 'shallow-ok')
	const detectionTimeout = parseDetectionTimeoutMs(context.flags.timeout)
	const orphans = await listOrphanBranches(context.gitRoot, {
		detectionTimeout,
		shallowOk,
	})
	const health = computeOrphanHealth(orphans)

	return {
		data: { orphans, health },
		exitCode: health.allFailed ? EXIT_RUNTIME : undefined,
	}
}
