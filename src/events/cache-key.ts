/**
 * Event server cache-key utilities.
 *
 * Why: PID/port discovery files must use a stable per-repository key that does
 * not collide for repositories with the same directory name.
 */

import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * Build a stable cache key from an absolute repository root path.
 *
 * Why: Using only `basename(gitRoot)` causes collisions across repos that share
 * names (for example multiple `app` directories). The hash suffix provides
 * uniqueness while keeping keys human-readable.
 */
export function getRepoCacheKey(gitRoot: string): string {
	const normalizedRoot = path.resolve(gitRoot)
	const baseName = path
		.basename(normalizedRoot)
		.replace(/[^a-zA-Z0-9._-]/g, '_')
	const digest = createHash('sha256')
		.update(normalizedRoot)
		.digest('hex')
		.slice(0, 12)
	return `${baseName || 'repo'}-${digest}`
}

/**
 * Get the cache directory for an event server discovery key.
 *
 * Why: Centralized cache-dir derivation keeps server and emitter lookup
 * behavior consistent.
 */
export function getEventCacheDir(cacheKey: string): string {
	return path.join(os.homedir(), '.cache', 'side-quest-git', cacheKey)
}
