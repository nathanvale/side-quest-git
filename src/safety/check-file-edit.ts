import { PROTECTED_FILE_PATTERNS } from './patterns.js'

export interface FileEditCheckResult {
	readonly blocked: boolean
	readonly reason?: string
}

/**
 * Check whether a file path matches any protected edit pattern.
 */
export function checkFileEdit(filePath: string): FileEditCheckResult {
	for (const { pattern, reason } of PROTECTED_FILE_PATTERNS) {
		if (pattern.test(filePath)) {
			return { blocked: true, reason }
		}
	}
	return { blocked: false }
}
