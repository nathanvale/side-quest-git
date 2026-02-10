import { BLOCKED_PATTERNS } from './patterns.js'

export interface SafetyCheckResult {
	readonly blocked: boolean
	readonly reason?: string
}

/**
 * Check whether a command matches any blocked git safety pattern.
 */
export function checkCommand(command: string): SafetyCheckResult {
	for (const { pattern, reason } of BLOCKED_PATTERNS) {
		if (pattern.test(command)) {
			return { blocked: true, reason }
		}
	}
	return { blocked: false }
}
