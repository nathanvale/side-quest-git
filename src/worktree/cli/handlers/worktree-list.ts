import { listWorktrees } from '../../list.js'
import { computeListHealth, computeOrphanHealth } from '../../list-health.js'
import { listOrphanBranches } from '../../orphans.js'
import { EXIT_RUNTIME } from '../exit-codes.js'
import { parseBooleanFlag, parseDetectionTimeoutMs } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree list`.
 *
 * Why: This is the primary read API for worktree state and health.
 */
export async function handleWorktreeList(
	context: CommandContext,
): Promise<CommandResult> {
	const showAll = parseBooleanFlag(context.flags, 'all')
	const includeOrphans = parseBooleanFlag(context.flags, 'include-orphans')
	const shallowOk = parseBooleanFlag(context.flags, 'shallow-ok')
	const detectionTimeout = parseDetectionTimeoutMs(context.flags.timeout)

	const worktrees = await listWorktrees(context.gitRoot, {
		detectionTimeout,
		shallowOk,
	})
	const filtered = showAll
		? worktrees
		: worktrees.filter((worktree) => !worktree.isMain)
	const health = computeListHealth(worktrees)

	if (includeOrphans) {
		const orphans = await listOrphanBranches(context.gitRoot, {
			detectionTimeout,
			shallowOk,
		})
		const orphanHealth = computeOrphanHealth(orphans)
		return {
			data: { worktrees: filtered, orphans, health, orphanHealth },
			exitCode: health.allFailed ? EXIT_RUNTIME : undefined,
		}
	}

	return {
		data: { worktrees: filtered, health },
		exitCode: health.allFailed ? EXIT_RUNTIME : undefined,
	}
}
