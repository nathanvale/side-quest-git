import { appendToFileSync, ensureParentDirSync } from '@side-quest/core/fs'

/**
 * Append one or more JSON objects as newline-delimited JSON.
 */
export function appendJsonl(
	filePath: string,
	entry: unknown | readonly unknown[],
): void {
	const entries = Array.isArray(entry) ? entry : [entry]
	if (entries.length === 0) {
		return
	}

	ensureParentDirSync(filePath)
	const payload = `${entries.map((item) => JSON.stringify(item)).join('\n')}\n`
	appendToFileSync(filePath, payload)
}
