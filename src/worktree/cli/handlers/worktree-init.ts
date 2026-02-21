import { loadOrDetectConfig, writeConfig } from '../../config.js'
import type { CommandContext, CommandResult } from './types.js'

/**
 * Handle `worktree init`.
 *
 * Why: Ensures deterministic initialization of `.worktrees.json`.
 */
export async function handleWorktreeInit(
	context: CommandContext,
): Promise<CommandResult> {
	const { config, autoDetected } = loadOrDetectConfig(context.gitRoot)

	if (!autoDetected) {
		return {
			data: {
				message: '.worktrees.json already exists',
				config,
			},
		}
	}

	writeConfig(context.gitRoot, config)
	return {
		data: {
			message: 'Created .worktrees.json with auto-detected settings',
			config,
		},
	}
}
