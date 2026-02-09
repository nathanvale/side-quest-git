/**
 * Shared shell command validation for worktree lifecycle hooks.
 *
 * Used by both postCreate (create.ts) and preDelete (delete.ts) to ensure
 * user-configured hook commands don't contain shell injection patterns.
 */

import { validateShellSafePattern } from '@side-quest/core/validation'

/** Validates that a shell command contains only safe tokens. */
export function validateShellCommand(command: string): void {
	const tokens = command.trim().split(/\s+/).filter(Boolean)
	for (const token of tokens) {
		validateShellSafePattern(token)
	}
}
