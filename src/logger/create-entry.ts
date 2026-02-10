import type { CommandLogEntry, CommandLogParams } from './types.js'

/**
 * Create a log entry from hook-like post-tool input.
 */
export function createLogEntry(
	input: CommandLogParams,
): CommandLogEntry | null {
	if (input.tool_name !== 'Bash') {
		return null
	}

	const command = input.tool_input?.command
	if (typeof command !== 'string') {
		return null
	}

	return {
		timestamp: new Date().toISOString(),
		session_id: input.session_id || 'unknown',
		cwd: input.cwd || 'unknown',
		command,
	}
}
