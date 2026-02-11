/**
 * Smart install detection for worktrees.
 *
 * Determines whether dependency installation is needed by comparing
 * lockfile mtime against node_modules mtime. Runs the appropriate
 * package manager install command.
 *
 * @module worktree/install
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import { pathExistsSync } from '@side-quest/core/fs'
import { commandExists, spawnAndCollect } from '@side-quest/core/spawn'
import {
	detectInstallCommand,
	detectLockfile,
	detectPackageManager,
} from './detect-pm.js'
import type { InstallResult } from './types.js'

/**
 * Check whether dependency installation should run.
 *
 * Why: Worktree creation copies lockfiles but not node_modules. We need
 * to detect whether install is needed by checking if node_modules exists
 * and comparing its mtime against the lockfile.
 *
 * @param dir - Worktree directory to check
 * @returns true if install should run
 */
export function shouldRunInstall(dir: string): boolean {
	const lockfilePath = detectLockfile(dir)
	if (!lockfilePath) return false

	const nodeModulesPath = path.join(dir, 'node_modules')
	if (!pathExistsSync(nodeModulesPath)) return true

	try {
		const lockfileStat = statSync(lockfilePath)
		const nmStat = statSync(nodeModulesPath)
		return lockfileStat.mtimeMs > nmStat.mtimeMs
	} catch {
		return true
	}
}

/**
 * Run package manager install in a directory.
 *
 * Never throws -- returns an `InstallResult` with status discriminant.
 * Uses a configurable timeout (default 120s) via AbortController.
 *
 * @param dir - Directory to install in
 * @param options - Optional configuration
 * @returns Install result with status, timing, and error info
 */
export async function runInstall(
	dir: string,
	options: { force?: boolean; timeoutMs?: number } = {},
): Promise<InstallResult> {
	const { force = false, timeoutMs = 120_000 } = options

	// Check for package.json
	if (!pathExistsSync(path.join(dir, 'package.json'))) {
		return {
			status: 'no-package-json',
			packageManager: null,
			durationMs: null,
			error: null,
		}
	}

	// Detect PM
	const pm = detectPackageManager(dir)
	const installCmd = detectInstallCommand(dir)

	if (!pm || !installCmd) {
		return {
			status: 'no-package-json',
			packageManager: null,
			durationMs: null,
			error: 'No lockfile found',
		}
	}

	// Check PM is on PATH
	if (!commandExists(pm)) {
		return {
			status: 'failed',
			packageManager: pm,
			durationMs: null,
			error: `${pm} is not installed or not on PATH`,
		}
	}

	// Check if install is needed (unless forced)
	if (!force && !shouldRunInstall(dir)) {
		return {
			status: 'up-to-date',
			packageManager: pm,
			durationMs: null,
			error: null,
		}
	}

	// Run install with timeout
	const start = performance.now()
	try {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)

		const cmdParts = installCmd.split(' ')
		const result = await spawnAndCollect(cmdParts, {
			cwd: dir,
			signal: controller.signal,
		})

		clearTimeout(timer)
		const durationMs = Math.round(performance.now() - start)

		if (result.exitCode !== 0) {
			return {
				status: 'failed',
				packageManager: pm,
				durationMs,
				error:
					result.stderr.trim() || 'Install command exited with non-zero code',
			}
		}

		return {
			status: 'installed',
			packageManager: pm,
			durationMs,
			error: null,
		}
	} catch (err) {
		const durationMs = Math.round(performance.now() - start)
		return {
			status: 'failed',
			packageManager: pm,
			durationMs,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}
