/**
 * Health metadata computation for worktree and orphan branch lists.
 *
 * Why: The structured DetectionIssue model gives us rich per-entry error
 * data, but callers need an aggregate view to make a single go/no-go
 * decision. This module distils the per-entry issues into a compact
 * metadata object so the CLI (and any other caller) can exit non-zero
 * when *all* enrichments have failed rather than silently returning
 * degraded data.
 *
 * @module worktree/list-health
 */

import type { OrphanBranch, WorktreeInfo } from './types.js'

/**
 * Aggregate health metadata for a list of worktrees or orphan branches.
 *
 * Why: Computed once from the results array and passed alongside the data
 * so downstream consumers (CLI, tests, scripts) don't have to re-derive it.
 */
export interface ListHealthMetadata {
	/** Total number of entries in the list. */
	readonly total: number
	/** Entries that have at least one issue of any severity. */
	readonly degradedCount: number
	/** Entries that have at least one error-severity issue. */
	readonly fatalCount: number
	/**
	 * True when every entry has at least one error-severity issue.
	 *
	 * Why: This is the systemic-failure signal. A single bad entry is
	 * normal (network blip, deleted worktree path); *all* entries failing
	 * means the environment is broken and callers should exit non-zero.
	 */
	readonly allFailed: boolean
}

/**
 * Compute health metadata from a list of WorktreeInfo entries.
 *
 * Why: A pure function over the array is the simplest design -- it keeps
 * listWorktrees() return type stable (no breaking change) while giving
 * callers a single import for the aggregate view.
 *
 * @param worktrees - Array returned by listWorktrees()
 * @returns Aggregate health metadata
 */
export function computeListHealth(
	worktrees: readonly WorktreeInfo[],
): ListHealthMetadata {
	return computeHealth(worktrees, (entry) => entry.issues)
}

/**
 * Compute health metadata from a list of OrphanBranch entries.
 *
 * Why: Orphan branches share the same issues structure as WorktreeInfo,
 * so one generic helper covers both, but we expose typed wrappers to
 * keep call sites self-documenting.
 *
 * @param orphans - Array returned by listOrphanBranches()
 * @returns Aggregate health metadata
 */
export function computeOrphanHealth(
	orphans: readonly OrphanBranch[],
): ListHealthMetadata {
	return computeHealth(orphans, (entry) => entry.issues)
}

/**
 * Internal generic health computation shared by both exported helpers.
 *
 * Why: DRY -- WorktreeInfo and OrphanBranch have the same `issues` shape
 * but are distinct types. A generic with a selector avoids casting.
 */
function computeHealth<T>(
	entries: readonly T[],
	getIssues: (entry: T) => readonly { severity: string }[] | undefined,
): ListHealthMetadata {
	const total = entries.length

	let degradedCount = 0
	let fatalCount = 0

	for (const entry of entries) {
		const issues = getIssues(entry)
		if (!issues || issues.length === 0) continue
		degradedCount++
		const hasFatal = issues.some((i) => i.severity === 'error')
		if (hasFatal) fatalCount++
	}

	// allFailed only applies when there is at least one entry -- an empty
	// list is not a systemic failure (repo may simply have no worktrees).
	const allFailed = total > 0 && fatalCount === total

	return { total, degradedCount, fatalCount, allFailed }
}
