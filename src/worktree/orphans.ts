/**
 * Orphan branch discovery.
 *
 * Identifies local branches that have no associated worktree and classifies
 * them by their merge status relative to the main branch.
 *
 * @module worktree/orphans
 */

import { processInParallelChunks } from '@side-quest/core/concurrency'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import { createDetectionIssue, DETECTION_CODES } from './detection-issue.js'
import { checkIsShallow, detectMergeStatus } from './merge-status.js'
import type { OrphanBranch, OrphanStatus } from './types.js'
import { checkUpstreamGone } from './upstream-gone.js'

/** Default branches that should never be considered orphans. */
const DEFAULT_PROTECTED = ['main', 'master', 'develop']

/**
 * Get the set of branch names that currently have worktrees.
 *
 * Why: `listWorktrees()` does full enrichment (merge detection, dirty checks,
 * etc.) which is wasteful when we only need branch names to filter orphans.
 * Parsing raw porcelain output is orders of magnitude cheaper.
 *
 * @param gitRoot - Main worktree root
 * @returns Set of branch names that have worktrees
 */
export async function getWorktreeBranches(
	gitRoot: string,
): Promise<Set<string>> {
	const result = await spawnAndCollect(
		['git', 'worktree', 'list', '--porcelain'],
		{ cwd: gitRoot },
	)
	if (result.exitCode !== 0) {
		throw new Error(`Failed to list worktrees: ${result.stderr.trim()}`)
	}

	const branches = new Set<string>()
	for (const line of result.stdout.split('\n')) {
		// Porcelain format: "branch refs/heads/<name>"
		if (line.startsWith('branch refs/heads/')) {
			branches.add(line.slice('branch refs/heads/'.length).trim())
		}
	}
	return branches
}

/** Options for listOrphanBranches. */
export interface ListOrphanBranchesOptions {
	/** Branches that should never be considered orphans. */
	protectedBranches?: readonly string[]
	/**
	 * Override the Layer 3 cherry detection timeout in milliseconds.
	 *
	 * Why: Allows callers (e.g. `--timeout` CLI flag) to tune squash detection
	 * per-run without touching env vars. Precedence: this value >
	 * SIDE_QUEST_DETECTION_TIMEOUT_MS env var > default 5000ms.
	 */
	detectionTimeout?: number
	/**
	 * Skip the shallow clone guard during merge detection.
	 *
	 * Why: CI environments often use shallow clones. Pass this when clone depth
	 * is known to be sufficient for the branches under inspection.
	 */
	shallowOk?: boolean
}

/**
 * List local branches that have no associated worktree.
 *
 * Why: Over time, branches accumulate without cleanup. This function
 * identifies branches that aren't checked out in any worktree, classifies
 * their merge status, and lets batch cleanup tools decide what to do.
 *
 * @param gitRoot - Main worktree root
 * @param options - Options for filtering and detection tuning
 * @returns Array of orphan branches with status info
 */
export async function listOrphanBranches(
	gitRoot: string,
	options: ListOrphanBranchesOptions = {},
): Promise<OrphanBranch[]> {
	const protectedSet = new Set(options.protectedBranches ?? DEFAULT_PROTECTED)

	// Get all local branches
	const branchResult = await spawnAndCollect(
		['git', 'branch', '--format=%(refname:short)'],
		{ cwd: gitRoot },
	)
	if (branchResult.exitCode !== 0) {
		throw new Error(`Failed to list branches: ${branchResult.stderr.trim()}`)
	}

	const allBranches = branchResult.stdout
		.trim()
		.split('\n')
		.filter((b) => b.length > 0)

	// Get branches that have worktrees using lightweight porcelain parse.
	// Why: avoids full enrichment (merge detection, dirty checks) that
	// listWorktrees() would do -- we only need branch names here.
	const worktreeBranches = await getWorktreeBranches(gitRoot)

	// Get main branch for merge comparison
	const mainBranch = await getMainBranch(gitRoot)

	// Filter to orphan candidates (no worktree, not protected)
	const orphanCandidates = allBranches.filter(
		(branch) => !protectedSet.has(branch) && !worktreeBranches.has(branch),
	)

	// Skip shallow check when detection is fully disabled -- no git subprocesses
	// should run at all during an incident (SIDE_QUEST_NO_DETECTION=1).
	const isShallow =
		process.env.SIDE_QUEST_NO_DETECTION === '1'
			? null
			: await checkIsShallow(gitRoot)

	// Per-item timeout: same safety net as list.ts. A slow branch detection
	// (e.g. huge history, slow disk) should not block the entire chunk.
	const itemTimeoutMs = Number(process.env.SIDE_QUEST_ITEM_TIMEOUT_MS ?? 10000)

	return processInParallelChunks({
		items: orphanCandidates,
		chunkSize: 4,
		processor: async (branch) => {
			const signal = AbortSignal.timeout(itemTimeoutMs)

			// Run merge detection and upstream-gone check concurrently -- they are
			// independent git calls and neither blocks the other.
			const [detection, upstreamGone] = await Promise.all([
				detectMergeStatus(gitRoot, branch, mainBranch, {
					isShallow,
					signal,
					...(options.detectionTimeout !== undefined
						? { timeout: options.detectionTimeout }
						: {}),
					...(options.shallowOk !== undefined
						? { shallowOk: options.shallowOk }
						: {}),
				}),
				checkUpstreamGone(gitRoot, branch),
			])

			let status: OrphanStatus
			let commitsAhead: number

			// CRITICAL: check detectionError FIRST to prevent masking failures as 'pristine'
			if (detection.detectionError) {
				status = 'unknown'
				commitsAhead = detection.commitsAhead
			} else if (detection.merged) {
				status = 'merged'
				commitsAhead = 0
			} else if (detection.commitsAhead > 0) {
				status = 'ahead'
				commitsAhead = detection.commitsAhead
			} else if (detection.commitsAhead === 0) {
				status = 'pristine'
				commitsAhead = 0
			} else {
				status = 'unknown'
				commitsAhead = -1
			}

			return {
				branch,
				status,
				commitsAhead,
				merged: detection.merged,
				mergeMethod: detection.mergeMethod,
				detectionError: detection.detectionError,
				issues: detection.issues,
				// Only include the field when it is true to keep output clean for the common case.
				...(upstreamGone ? { upstreamGone: true } : {}),
			}
		},
		onError: (branch, error) => {
			const errorMsg = error instanceof Error ? error.message : String(error)
			const issues = [
				createDetectionIssue(
					DETECTION_CODES.ENRICHMENT_FAILED,
					'error',
					'enrichment',
					errorMsg,
					false,
				),
			]
			return {
				branch,
				status: 'unknown' as OrphanStatus,
				commitsAhead: -1,
				merged: false,
				mergeMethod: undefined,
				detectionError: errorMsg,
				issues,
			}
		},
	})
}
