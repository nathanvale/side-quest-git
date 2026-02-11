/**
 * Worktree file synchronization.
 *
 * Re-copies configuration files from the main worktree to linked worktrees,
 * using content hashing to skip files that haven't changed.
 *
 * Why: After creating a worktree, config files (e.g., .env, CLAUDE.md) may
 * change in the main worktree. This module re-syncs only files whose content
 * has actually changed, using Bun's built-in xxHash for fast comparison.
 *
 * @module worktree/sync
 */

import fs from 'node:fs'
import path from 'node:path'
import {
	copyFileSync,
	ensureParentDirSync,
	pathExistsSync,
	walkDirectory,
} from '@side-quest/core/fs'
import { globFilesSync, matchGlob } from '@side-quest/core/glob'
import { loadOrDetectConfig } from './config.js'
import { listWorktrees } from './list.js'
import type { SyncedFile, SyncResult } from './types.js'

/**
 * Hash file contents for comparison.
 *
 * Uses Bun.hash (xxHash64) for fast non-cryptographic hashing.
 * Returns null if the file can't be read (missing, permission error, etc.).
 *
 * @param filePath - Absolute path to the file
 * @returns String representation of the hash, or null on error
 */
function hashFile(filePath: string): string | null {
	try {
		const content = fs.readFileSync(filePath)
		return String(Bun.hash(content))
	} catch {
		return null
	}
}

/**
 * Sync configuration files from the main worktree to a linked worktree.
 *
 * Compares content hashes between source and destination to skip files
 * that haven't changed. Supports dry-run mode for previewing changes.
 *
 * @param gitRoot - Absolute path to the main worktree (git root)
 * @param branchName - Branch name of the target worktree
 * @param options - Sync options (dryRun to preview without writing)
 * @returns Sync result with per-file detail
 */
export async function syncWorktree(
	gitRoot: string,
	branchName: string,
	options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
	const { dryRun = false } = options
	const { config } = loadOrDetectConfig(gitRoot)
	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

	if (!pathExistsSync(worktreePath)) {
		throw new Error(`Worktree not found at ${worktreePath}`)
	}

	const files: SyncedFile[] = []
	let filesCopied = 0
	let filesSkipped = 0

	// Collect files to sync using same logic as copyWorktreeFiles
	const filesToSync = collectFilesToSync(gitRoot, config.copy, config.exclude)

	for (const relativePath of filesToSync) {
		const srcPath = path.join(gitRoot, relativePath)
		const destPath = path.join(worktreePath, relativePath)

		// Compare content hashes
		const srcHash = hashFile(srcPath)
		const destHash = pathExistsSync(destPath) ? hashFile(destPath) : null

		if (srcHash === destHash && srcHash !== null) {
			files.push({
				relativePath,
				action: 'skipped',
				reason: 'identical content',
			})
			filesSkipped++
			continue
		}

		if (dryRun) {
			files.push({
				relativePath,
				action: 'copied',
				reason: destHash === null ? 'new file' : 'content changed',
			})
			filesCopied++
			continue
		}

		try {
			ensureParentDirSync(destPath)
			copyFileSync(srcPath, destPath)
			files.push({
				relativePath,
				action: 'copied',
				reason: destHash === null ? 'new file' : 'content changed',
			})
			filesCopied++
		} catch (err) {
			files.push({
				relativePath,
				action: 'error',
				reason: err instanceof Error ? err.message : String(err),
			})
		}
	}

	return {
		branch: branchName,
		path: worktreePath,
		filesCopied,
		filesSkipped,
		files,
		dryRun,
	}
}

/**
 * Sync all non-main worktrees.
 *
 * Iterates over every linked worktree and syncs configuration files
 * from the main worktree. Errors for individual worktrees are caught
 * and returned as empty results rather than failing the entire batch.
 *
 * @param gitRoot - Absolute path to the main worktree (git root)
 * @param options - Sync options (dryRun to preview without writing)
 * @returns Array of sync results, one per non-main worktree
 */
export async function syncAllWorktrees(
	gitRoot: string,
	options: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
	const worktrees = await listWorktrees(gitRoot)
	const results: SyncResult[] = []

	for (const wt of worktrees) {
		if (wt.isMain) continue
		try {
			const result = await syncWorktree(gitRoot, wt.branch, options)
			results.push(result)
		} catch {
			// Return an empty result for worktrees that fail to sync
			results.push({
				branch: wt.branch,
				path: wt.path,
				filesCopied: 0,
				filesSkipped: 0,
				files: [],
				dryRun: options.dryRun ?? false,
			})
		}
	}

	return results
}

/**
 * Collect relative paths of files that should be synced.
 *
 * Mirrors the file-collection logic in copy-files.ts, but returns
 * relative paths instead of copying. Handles three cases:
 * - Root glob patterns (e.g., `.env.*`): resolved via glob at source root
 * - Root directory patterns (e.g., `.claude`): walked recursively
 * - Recursive patterns (e.g., `** /CLAUDE.md`): walked from source root
 *
 * @param source - Absolute path to the main worktree
 * @param patterns - Glob patterns from config.copy
 * @param excludeDirs - Directory names to skip
 * @returns Array of relative file paths
 */
function collectFilesToSync(
	source: string,
	patterns: readonly string[],
	excludeDirs: readonly string[],
): string[] {
	const relativePaths: string[] = []
	const seen = new Set<string>()

	const rootPatterns: string[] = []
	const recursivePatterns: string[] = []

	for (const pattern of patterns) {
		if (pattern.startsWith('**/')) {
			recursivePatterns.push(pattern)
		} else {
			rootPatterns.push(pattern)
		}
	}

	// Handle root patterns via glob
	for (const pattern of rootPatterns) {
		const matches = globFilesSync(pattern, { cwd: source, dot: true })
		for (const match of matches) {
			const rel = path.relative(source, match)
			if (isExcluded(rel, excludeDirs)) continue
			if (!seen.has(rel)) {
				seen.add(rel)
				relativePaths.push(rel)
			}
		}
	}

	// Handle root patterns that point to directories (e.g., ".claude")
	for (const pattern of rootPatterns) {
		if (pattern.includes('*')) continue // skip globs, already handled
		const fullPath = path.join(source, pattern)
		if (!pathExistsSync(fullPath)) continue

		try {
			if (fs.statSync(fullPath).isDirectory()) {
				walkDirectory(
					fullPath,
					(_fp, rp) => {
						const fullRel = path.join(pattern, rp)
						if (!seen.has(fullRel)) {
							seen.add(fullRel)
							relativePaths.push(fullRel)
						}
					},
					{ skipDirs: [...excludeDirs], skipHidden: false },
				)
			}
		} catch {
			// Not accessible, skip
		}
	}

	// Handle recursive patterns via walkDirectory
	if (recursivePatterns.length > 0) {
		walkDirectory(
			source,
			(_fp, rp) => {
				for (const pattern of recursivePatterns) {
					if (matchGlob(pattern, rp) && !seen.has(rp)) {
						seen.add(rp)
						relativePaths.push(rp)
						break // Don't double-add if multiple patterns match
					}
				}
			},
			{ skipDirs: [...excludeDirs], skipHidden: false },
		)
	}

	return relativePaths
}

/** Check if a relative path starts with an excluded directory. */
function isExcluded(
	relativePath: string,
	excludeDirs: readonly string[],
): boolean {
	const parts = relativePath.split(path.sep)
	return parts.some((part) => excludeDirs.includes(part))
}
