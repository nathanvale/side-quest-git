/**
 * Orphan branch discovery.
 *
 * Identifies local branches that have no associated worktree and classifies
 * them by their merge status relative to the main branch.
 *
 * @module worktree/orphans
 */

import { spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import { listWorktrees } from './list.js'
import type { OrphanBranch, OrphanStatus } from './types.js'

/** Default branches that should never be considered orphans. */
const DEFAULT_PROTECTED = ['main', 'master', 'develop']

/**
 * List local branches that have no associated worktree.
 *
 * Why: Over time, branches accumulate without cleanup. This function
 * identifies branches that aren't checked out in any worktree, classifies
 * their merge status, and lets batch cleanup tools decide what to do.
 *
 * @param gitRoot - Main worktree root
 * @param options - Options for filtering
 * @returns Array of orphan branches with status info
 */
export async function listOrphanBranches(
	gitRoot: string,
	options: { protectedBranches?: readonly string[] } = {},
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

	// Get branches that have worktrees
	const worktrees = await listWorktrees(gitRoot)
	const worktreeBranches = new Set(worktrees.map((wt) => wt.branch))

	// Get main branch for merge comparison
	const mainBranch = await getMainBranch(gitRoot)

	// Find orphans: branches without worktrees, not protected
	const orphans: OrphanBranch[] = []
	for (const branch of allBranches) {
		if (protectedSet.has(branch)) continue
		if (worktreeBranches.has(branch)) continue

		const { status, commitsAhead, merged } = await classifyBranch(
			gitRoot,
			branch,
			mainBranch,
		)

		orphans.push({ branch, status, commitsAhead, merged })
	}

	return orphans
}

/**
 * Classify a branch's status relative to the main branch.
 */
async function classifyBranch(
	gitRoot: string,
	branch: string,
	mainBranch: string,
): Promise<{
	status: OrphanStatus
	commitsAhead: number
	merged: boolean
}> {
	// Check if merged
	const mergeResult = await spawnAndCollect(
		['git', 'merge-base', '--is-ancestor', branch, mainBranch],
		{ cwd: gitRoot },
	)
	const merged = mergeResult.exitCode === 0

	if (merged) {
		return { status: 'merged', commitsAhead: 0, merged: true }
	}

	// Count commits ahead
	const countResult = await spawnAndCollect(
		['git', 'rev-list', '--count', `${mainBranch}..${branch}`],
		{ cwd: gitRoot },
	)

	if (countResult.exitCode !== 0) {
		return { status: 'unknown', commitsAhead: -1, merged: false }
	}

	const commitsAhead = parseInt(countResult.stdout.trim(), 10)

	if (Number.isNaN(commitsAhead)) {
		return { status: 'unknown', commitsAhead: -1, merged: false }
	}

	if (commitsAhead === 0) {
		return { status: 'pristine', commitsAhead: 0, merged: false }
	}

	return { status: 'ahead', commitsAhead, merged: false }
}
