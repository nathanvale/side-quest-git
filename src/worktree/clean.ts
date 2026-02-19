/**
 * Batch worktree cleanup.
 *
 * Deletes merged and clean worktrees in batch. Supports force mode,
 * dry-run, branch deletion, and orphan branch cleanup.
 *
 * @module worktree/clean
 */

import { spawnAndCollect } from '@side-quest/core/spawn'
import { listWorktrees } from './list.js'
import { listOrphanBranches } from './orphans.js'
import type {
	CleanedWorktree,
	CleanResult,
	OrphanBranch,
	SkippedWorktree,
} from './types.js'

export interface CleanOptions {
	/** Delete all non-main worktrees regardless of status. */
	force?: boolean
	/** Preview what would be deleted without actually deleting. */
	dryRun?: boolean
	/** Also delete the git branch after removing the worktree. */
	deleteBranches?: boolean
	/** Also clean orphan branches (branches without worktrees). */
	includeOrphans?: boolean
	/**
	 * Skip the shallow clone guard during merge detection.
	 *
	 * Why: CI environments often use shallow clones. Pass this when clone depth
	 * is known to be sufficient for the branches under inspection.
	 */
	shallowOk?: boolean
	/**
	 * Override the Layer 3 cherry detection timeout in milliseconds.
	 *
	 * Why: Allows callers (e.g. `--timeout` CLI flag) to tune squash detection
	 * per-run without touching env vars. Precedence: this value >
	 * SIDE_QUEST_DETECTION_TIMEOUT_MS env var > default 5000ms.
	 */
	detectionTimeout?: number
	/**
	 * Max worktrees/branches to process in parallel during listing.
	 *
	 * Why: Allows callers to tune git subprocess fan-out per-run without
	 * touching env vars. Forwarded to listWorktrees and listOrphanBranches.
	 * Precedence: this value > SIDE_QUEST_CONCURRENCY env var > DEFAULT_CONCURRENCY (4).
	 */
	concurrency?: number
}

/**
 * Batch delete merged and clean worktrees.
 *
 * Why: Manual cleanup of multiple worktrees is tedious. This function
 * automates the process with safety checks: only merged+clean worktrees
 * are deleted by default. Force mode overrides dirty/unmerged checks
 * but NEVER deletes the main worktree.
 *
 * @param gitRoot - Main worktree root
 * @param options - Clean options
 * @returns Clean result with deleted, skipped, and orphan arrays
 */
export async function cleanWorktrees(
	gitRoot: string,
	options: CleanOptions = {},
): Promise<CleanResult> {
	const {
		force = false,
		dryRun = false,
		deleteBranches = false,
		includeOrphans = false,
		shallowOk,
		detectionTimeout,
		concurrency,
	} = options

	const worktrees = await listWorktrees(gitRoot, {
		shallowOk,
		detectionTimeout,
		concurrency,
	})
	const deleted: CleanedWorktree[] = []
	const skipped: SkippedWorktree[] = []

	// Process each worktree
	for (const wt of worktrees) {
		// NEVER delete main worktree
		if (wt.isMain) {
			skipped.push({
				branch: wt.branch,
				path: wt.path,
				reason: 'is-main',
			})
			continue
		}

		// Without force: skip dirty and unmerged
		if (!force) {
			if (wt.dirty) {
				skipped.push({
					branch: wt.branch,
					path: wt.path,
					reason: 'dirty',
					mergeMethod: wt.mergeMethod,
				})
				continue
			}
			if (!wt.merged) {
				skipped.push({
					branch: wt.branch,
					path: wt.path,
					reason: 'unmerged',
					mergeMethod: wt.mergeMethod,
				})
				continue
			}
		}

		if (dryRun) {
			deleted.push({
				branch: wt.branch,
				path: wt.path,
				branchDeleted: deleteBranches,
				mergeMethod: wt.mergeMethod,
			})
			continue
		}

		// Actually delete the worktree
		try {
			const removeArgs = ['git', 'worktree', 'remove', wt.path]
			if (force) removeArgs.push('--force')

			const removeResult = await spawnAndCollect(removeArgs, {
				cwd: gitRoot,
			})
			if (removeResult.exitCode !== 0) {
				skipped.push({
					branch: wt.branch,
					path: wt.path,
					reason: 'delete-failed',
					error: removeResult.stderr.trim(),
					mergeMethod: wt.mergeMethod,
				})
				continue
			}

			let branchDeleted = false
			if (deleteBranches) {
				const deleteFlag = force ? '-D' : '-d'
				const branchResult = await spawnAndCollect(
					['git', 'branch', deleteFlag, wt.branch],
					{ cwd: gitRoot },
				)
				branchDeleted = branchResult.exitCode === 0
			}

			deleted.push({
				branch: wt.branch,
				path: wt.path,
				branchDeleted,
				mergeMethod: wt.mergeMethod,
			})
		} catch (err) {
			skipped.push({
				branch: wt.branch,
				path: wt.path,
				reason: 'delete-failed',
				error: err instanceof Error ? err.message : String(err),
				mergeMethod: wt.mergeMethod,
			})
		}
	}

	// Handle orphan branches
	let orphansDeleted: OrphanBranch[] = []
	if (includeOrphans) {
		const orphans = await listOrphanBranches(gitRoot, {
			shallowOk,
			detectionTimeout,
			concurrency,
		})
		const mergedOrphans = force ? orphans : orphans.filter((o) => o.merged)

		if (dryRun) {
			orphansDeleted = mergedOrphans
		} else {
			for (const orphan of mergedOrphans) {
				const deleteFlag = force ? '-D' : '-d'
				const result = await spawnAndCollect(
					['git', 'branch', deleteFlag, orphan.branch],
					{ cwd: gitRoot },
				)
				if (result.exitCode === 0) {
					orphansDeleted.push(orphan)
				}
			}
		}
	}

	// Prune worktree list
	if (!dryRun && deleted.length > 0) {
		await spawnAndCollect(['git', 'worktree', 'prune'], { cwd: gitRoot })
	}

	return {
		deleted,
		skipped,
		orphansDeleted,
		dryRun,
		forced: force,
	}
}
