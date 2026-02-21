/**
 * Unit tests for computeListHealth and computeOrphanHealth.
 *
 * These are pure function tests -- no git subprocess, no tmp dirs needed.
 */

import { describe, expect, test } from 'bun:test'
import { createDetectionIssue, DETECTION_CODES } from './detection-issue.js'
import { computeListHealth, computeOrphanHealth } from './list-health.js'
import type { OrphanBranch, WorktreeInfo } from './types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal WorktreeInfo with no issues (healthy entry). */
function makeWorktree(branch: string): WorktreeInfo {
	return {
		branch,
		path: `/repo/.worktrees/${branch}`,
		head: 'abc1234',
		dirty: false,
		merged: false,
		isMain: false,
	}
}

/** Build a WorktreeInfo with an error-severity issue (fatal entry). */
function makeFatalWorktree(branch: string): WorktreeInfo {
	return {
		...makeWorktree(branch),
		detectionError: 'enrichment failed',
		issues: [
			createDetectionIssue(
				DETECTION_CODES.ENRICHMENT_FAILED,
				'error',
				'enrichment',
				'enrichment failed',
				false,
			),
		],
	}
}

/** Build a WorktreeInfo with a warning-severity issue (degraded but not fatal). */
function makeDegradedWorktree(branch: string): WorktreeInfo {
	return {
		...makeWorktree(branch),
		issues: [
			createDetectionIssue(
				DETECTION_CODES.CHERRY_TIMEOUT,
				'warning',
				'layer3-cherry',
				'cherry timed out',
				true,
			),
		],
	}
}

/** Build a minimal OrphanBranch with no issues (healthy entry). */
function makeOrphan(branch: string): OrphanBranch {
	return {
		branch,
		status: 'ahead',
		commitsAhead: 1,
		merged: false,
	}
}

/** Build an OrphanBranch with an error-severity issue (fatal entry). */
function makeFatalOrphan(branch: string): OrphanBranch {
	return {
		...makeOrphan(branch),
		status: 'unknown',
		detectionError: 'enrichment failed',
		issues: [
			createDetectionIssue(
				DETECTION_CODES.ENRICHMENT_FAILED,
				'error',
				'enrichment',
				'enrichment failed',
				false,
			),
		],
	}
}

// ---------------------------------------------------------------------------
// computeListHealth
// ---------------------------------------------------------------------------

describe('computeListHealth', () => {
	test('empty list: total=0, all counts zero, allFailed=false', () => {
		const health = computeListHealth([])
		expect(health.total).toBe(0)
		expect(health.degradedCount).toBe(0)
		expect(health.fatalCount).toBe(0)
		// An empty list is NOT a systemic failure
		expect(health.allFailed).toBe(false)
	})

	test('single healthy entry: degradedCount=0, fatalCount=0, allFailed=false', () => {
		const health = computeListHealth([makeWorktree('main')])
		expect(health.total).toBe(1)
		expect(health.degradedCount).toBe(0)
		expect(health.fatalCount).toBe(0)
		expect(health.allFailed).toBe(false)
	})

	test('single fatal entry: fatalCount=1, allFailed=true', () => {
		const health = computeListHealth([makeFatalWorktree('feat/broken')])
		expect(health.total).toBe(1)
		expect(health.degradedCount).toBe(1)
		expect(health.fatalCount).toBe(1)
		expect(health.allFailed).toBe(true)
	})

	test('single degraded (warning only) entry: degradedCount=1, fatalCount=0, allFailed=false', () => {
		// A warning-only entry is degraded but not fatal -- allFailed must be false
		const health = computeListHealth([makeDegradedWorktree('feat/warn')])
		expect(health.total).toBe(1)
		expect(health.degradedCount).toBe(1)
		expect(health.fatalCount).toBe(0)
		expect(health.allFailed).toBe(false)
	})

	test('mix of healthy and fatal: allFailed=false when at least one healthy', () => {
		const health = computeListHealth([makeWorktree('main'), makeFatalWorktree('feat/broken')])
		expect(health.total).toBe(2)
		expect(health.degradedCount).toBe(1)
		expect(health.fatalCount).toBe(1)
		// One healthy entry means NOT all failed
		expect(health.allFailed).toBe(false)
	})

	test('all fatal entries: allFailed=true', () => {
		const health = computeListHealth([
			makeFatalWorktree('feat/a'),
			makeFatalWorktree('feat/b'),
			makeFatalWorktree('feat/c'),
		])
		expect(health.total).toBe(3)
		expect(health.degradedCount).toBe(3)
		expect(health.fatalCount).toBe(3)
		expect(health.allFailed).toBe(true)
	})

	test('mix of fatal and warning: fatalCount counts only error-severity', () => {
		const health = computeListHealth([makeFatalWorktree('feat/a'), makeDegradedWorktree('feat/b')])
		expect(health.total).toBe(2)
		expect(health.degradedCount).toBe(2)
		// Only one has an error-severity issue
		expect(health.fatalCount).toBe(1)
		// Not all entries are fatal -- feat/b has only a warning
		expect(health.allFailed).toBe(false)
	})

	test('entry with issues=undefined (no issues field): counts as healthy', () => {
		// WorktreeInfo.issues is optional -- absence means no issues
		const wt: WorktreeInfo = makeWorktree('main')
		expect(wt.issues).toBeUndefined()
		const health = computeListHealth([wt])
		expect(health.degradedCount).toBe(0)
		expect(health.fatalCount).toBe(0)
	})

	test('entry with issues=[] (empty array): counts as healthy', () => {
		const wt: WorktreeInfo = { ...makeWorktree('main'), issues: [] }
		const health = computeListHealth([wt])
		expect(health.degradedCount).toBe(0)
		expect(health.fatalCount).toBe(0)
	})

	test('total matches input array length exactly', () => {
		const entries = Array.from({ length: 7 }, (_, i) => makeWorktree(`feat/${i}`))
		const health = computeListHealth(entries)
		expect(health.total).toBe(7)
	})
})

// ---------------------------------------------------------------------------
// computeOrphanHealth
// ---------------------------------------------------------------------------

describe('computeOrphanHealth', () => {
	test('empty list: total=0, allFailed=false', () => {
		const health = computeOrphanHealth([])
		expect(health.total).toBe(0)
		expect(health.allFailed).toBe(false)
	})

	test('single healthy orphan: no issues', () => {
		const health = computeOrphanHealth([makeOrphan('feat/old')])
		expect(health.total).toBe(1)
		expect(health.degradedCount).toBe(0)
		expect(health.fatalCount).toBe(0)
		expect(health.allFailed).toBe(false)
	})

	test('single fatal orphan: allFailed=true', () => {
		const health = computeOrphanHealth([makeFatalOrphan('feat/broken')])
		expect(health.total).toBe(1)
		expect(health.fatalCount).toBe(1)
		expect(health.allFailed).toBe(true)
	})

	test('mix healthy and fatal orphans: allFailed=false', () => {
		const health = computeOrphanHealth([makeOrphan('feat/ok'), makeFatalOrphan('feat/broken')])
		expect(health.total).toBe(2)
		expect(health.fatalCount).toBe(1)
		expect(health.allFailed).toBe(false)
	})

	test('all fatal orphans: allFailed=true', () => {
		const health = computeOrphanHealth([makeFatalOrphan('feat/a'), makeFatalOrphan('feat/b')])
		expect(health.total).toBe(2)
		expect(health.fatalCount).toBe(2)
		expect(health.allFailed).toBe(true)
	})
})
