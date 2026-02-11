/**
 * Package manager detection from lockfile presence.
 *
 * Checks for lockfiles in priority order (bun > yarn > pnpm > npm)
 * and returns the appropriate install command, package manager name,
 * or lockfile path.
 *
 * @module worktree/detect-pm
 */

import path from 'node:path'
import { pathExistsSync, readJsonFileSync } from '@side-quest/core/fs'

/** Lockfile-to-install-command mapping, ordered by priority. */
const LOCKFILE_MAP: ReadonlyArray<readonly [string, string]> = [
	['bun.lock', 'bun install'],
	['bun.lockb', 'bun install'],
	['yarn.lock', 'yarn install'],
	['pnpm-lock.yaml', 'pnpm install'],
	['package-lock.json', 'npm install'],
]

/** Lockfile to package manager name mapping. */
const PM_MAP: ReadonlyArray<readonly [string, string]> = [
	['bun.lock', 'bun'],
	['bun.lockb', 'bun'],
	['yarn.lock', 'yarn'],
	['pnpm-lock.yaml', 'pnpm'],
	['package-lock.json', 'npm'],
]

/** Valid package manager names for the packageManager field fallback. */
const VALID_PMS = ['bun', 'yarn', 'pnpm', 'npm']

/**
 * Detect the package manager install command for a directory.
 *
 * Checks for lockfiles in priority order: bun > yarn > pnpm > npm.
 * Returns null if no lockfile is found.
 *
 * @param dir - Directory to check for lockfiles
 * @returns Install command string, or null if no lockfile found
 */
export function detectInstallCommand(dir: string): string | null {
	for (const [lockfile, command] of LOCKFILE_MAP) {
		if (pathExistsSync(path.join(dir, lockfile))) {
			return command
		}
	}
	return null
}

/**
 * Detect the package manager for a directory.
 *
 * Why: Install detection needs to know which PM to use before constructing
 * the install command. Also checks `packageManager` field in package.json
 * as a fallback when no lockfile is present.
 *
 * @param dir - Directory to check
 * @returns Package manager name ('bun' | 'yarn' | 'pnpm' | 'npm'), or null
 */
export function detectPackageManager(dir: string): string | null {
	// Check lockfiles first (takes priority)
	for (const [lockfile, pm] of PM_MAP) {
		if (pathExistsSync(path.join(dir, lockfile))) {
			return pm
		}
	}

	// Fallback: check packageManager field in package.json
	const pkgPath = path.join(dir, 'package.json')
	if (pathExistsSync(pkgPath)) {
		try {
			const pkg = readJsonFileSync<{ packageManager?: string }>(pkgPath)
			if (typeof pkg.packageManager === 'string') {
				const name = pkg.packageManager.split('@')[0] ?? ''
				if (VALID_PMS.includes(name)) {
					return name
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	return null
}

/**
 * Detect the lockfile path for a directory.
 *
 * @param dir - Directory to check
 * @returns Absolute path to the lockfile, or null if none found
 */
export function detectLockfile(dir: string): string | null {
	for (const [lockfile] of PM_MAP) {
		const fullPath = path.join(dir, lockfile)
		if (pathExistsSync(fullPath)) {
			return fullPath
		}
	}
	return null
}
