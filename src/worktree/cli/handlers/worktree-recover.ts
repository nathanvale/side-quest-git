import {
	cleanupBackupRefs,
	listBackupRefs,
	restoreBackupRef,
} from '../../backup.js'
import { parseBooleanFlag, parseMaxAgeDays } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree recover`.
 *
 * Why: Recovery operations share one command with three execution modes.
 */
export async function handleWorktreeRecover(
	context: CommandContext,
): Promise<CommandResult> {
	const cleanup = parseBooleanFlag(context.flags, 'cleanup')
	const maxAgeDays = parseMaxAgeDays(context.flags['max-age'])

	if (cleanup) {
		const cleaned = await cleanupBackupRefs(context.gitRoot, maxAgeDays)
		return { data: { cleaned, count: cleaned.length } }
	}

	const targetBranch = context.positional[0]
	if (targetBranch) {
		await restoreBackupRef(context.gitRoot, targetBranch)
		return { data: { restored: targetBranch } }
	}

	const refs = await listBackupRefs(context.gitRoot)
	return { data: refs }
}
