/**
 * Pure status string formatter for worktree display.
 *
 * Converts structured merge/dirty state into human-readable status strings.
 * No git calls -- this is a pure function.
 *
 * @module worktree/status-string
 */

import type { MergeMethod } from './types.js'

/** Input for building a status string. */
export interface StatusInput {
	/** Whether the branch is merged (derived from mergeMethod). */
	readonly merged: boolean
	/** Whether the worktree has uncommitted changes. */
	readonly dirty: boolean
	/** Number of commits ahead of the target branch. */
	readonly commitsAhead: number
	/** Number of commits behind the target branch. */
	readonly commitsBehind?: number
	/** How the branch was merged, if applicable. */
	readonly mergeMethod?: MergeMethod
}

/**
 * Build a human-readable status string from merge/dirty state.
 *
 * Why: Multiple consumers (list, delete) need identical status strings.
 * Centralizing the logic prevents drift and ensures squash-merge
 * awareness is applied consistently.
 *
 * @param input - Structured status input
 * @returns Human-readable status string
 */
export function buildStatusString(input: StatusInput): string {
	// Special handling: merged ancestor at same commit (commitsBehind === 0)
	// These shouldn't be displayed as "merged" since main hasn't moved forward
	if (input.merged && input.commitsAhead === 0) {
		const commitsBehind = input.commitsBehind ?? 0
		if (commitsBehind === 0) {
			// At same commit as main - don't use "merged" status
			// Instead use "pristine" or "dirty"
			return input.dirty ? 'dirty' : 'pristine'
		}
		// Main has moved forward - this is truly merged
		if (input.dirty) {
			return input.mergeMethod === 'squash'
				? 'merged (squash), dirty'
				: 'merged, dirty'
		}
		return input.mergeMethod === 'squash' ? 'merged (squash)' : 'merged'
	}

	// Merged with uncommitted changes (has commits ahead)
	if (input.merged && input.dirty) {
		return input.mergeMethod === 'squash'
			? 'merged (squash), dirty'
			: 'merged, dirty'
	}

	// Merged, clean (has commits ahead)
	if (input.merged) {
		return input.mergeMethod === 'squash' ? 'merged (squash)' : 'merged'
	}

	const commitsBehind = input.commitsBehind ?? 0

	// Not merged, has commits ahead with behind count and uncommitted changes
	if (input.commitsAhead > 0 && commitsBehind > 0 && input.dirty) {
		return `${input.commitsAhead} ahead, ${commitsBehind} behind, dirty`
	}

	// Not merged, has commits ahead with behind count
	if (input.commitsAhead > 0 && commitsBehind > 0) {
		return `${input.commitsAhead} ahead, ${commitsBehind} behind`
	}

	// Not merged, has commits ahead with uncommitted changes (no behind)
	if (input.commitsAhead > 0 && input.dirty) {
		return `${input.commitsAhead} ahead, dirty`
	}

	// Not merged, has commits ahead (no behind, no dirty)
	if (input.commitsAhead > 0) {
		return `${input.commitsAhead} ahead`
	}

	// Not merged, only behind with uncommitted changes
	if (commitsBehind > 0 && input.dirty) {
		return `${commitsBehind} behind, dirty`
	}

	// Not merged, only behind
	if (commitsBehind > 0) {
		return `${commitsBehind} behind`
	}

	// Only uncommitted changes, not ahead, not behind
	if (input.dirty) {
		return 'dirty'
	}

	// Fallback for unexpected states (not merged, not ahead, not behind, not dirty)
	return 'unknown'
}
