# Phase 2+3: Structured Errors & Type Propagation - Execution Report

**Date:** 2026-02-20
**Branch:** feat/close-all-open-issues
**Issues Closed:** #18, #20, #21, #22, #23, #30

## Summary

Phase 2 replaced the free-form `detectionError?: string` with a structured `DetectionIssue` model, giving each error a stable code, severity, source layer, and reliability flag. Phase 3 propagated missing fields (`mergeMethod`, `commitsBehind`, `issues`) across all consumer types and deduplicated the ahead/behind counting utility.

## Tasks Completed

### Task 5: Implement Structured Error Model (#18)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: a1222ce
**Result:** PASS - 308 tests

**Changes:**
- Created `src/worktree/detection-issue.ts` - `DetectionIssue` interface, `DETECTION_CODES` constants (12 codes), `createDetectionIssue` helper
- Created `src/worktree/detection-issue.test.ts` - 107 lines of tests
- Modified `src/worktree/merge-status.ts` - Added `issues` to `MergeDetectionResult`, updated all error paths to create structured issues, added `issuestoDetectionError` helper for backward compat
- Modified `src/worktree/types.ts` - Added `issues?: readonly DetectionIssue[]` to `WorktreeInfo` and `OrphanBranch`
- Modified `src/worktree/list.ts` - Propagate `issues` from detection, structured `ENRICHMENT_FAILED` in onError handler
- Modified `src/worktree/orphans.ts` - Propagate `issues`, optimize with `getWorktreeBranches()` lightweight helper
- Modified `src/worktree/index.ts` - Exported new types and functions

**Key Decision:** `SIDE_QUEST_NO_SQUASH_DETECTION=1` silent-skip path does NOT add a `DETECTION_DISABLED` issue (preserving existing invariant that `detectionError` is undefined for that path).

### Task 6: Add detectionError to DeleteCheck (#30)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: a009e87
**Result:** PASS - 16 delete tests passing

**Changes:**
- Modified `src/worktree/delete.ts` - Added `detectionError?: string` and `issues?: readonly DetectionIssue[]` to `DeleteCheck`, propagated from `detectMergeStatus` result using conditional spread pattern
- Modified `src/worktree/delete.test.ts` - 2 new tests (clean detection = undefined, kill switch = surfaces both fields)

### Task 7: Add mergeMethod to WorktreeStatus (#23)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: aa01c0c
**Result:** PASS - 321 tests

**Changes:**
- Modified `src/worktree/types.ts` - Added `mergeMethod?: MergeMethod` to `WorktreeStatus`
- Modified `src/worktree/status.ts` - Propagated `wt.mergeMethod` into return value
- Modified `src/worktree/status.test.ts` - 3 new tests (unmerged, ancestor-merged, squash-merged)

### Task 8: Propagate mergeMethod to CLI Event Payloads (#22)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: ab0ec6e
**Result:** PASS - 333 tests

**Changes:**
- Modified `src/worktree/types.ts` - Added `mergeMethod?: MergeMethod` to `DeleteResult`
- Modified `src/worktree/delete.ts` - `deleteWorktree()` now runs `detectMergeStatus` before removal to populate mergeMethod
- Modified `src/worktree/delete.test.ts` - 3 new tests for mergeMethod in DeleteResult

**Key Decision:** Detection runs BEFORE worktree removal because after removal the working tree is gone. `worktree.cleaned` events already had mergeMethod via CleanedWorktree.

### Task 9: Display commitsBehind in Status Strings (#20)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: aad9165
**Result:** PASS - 321 tests (at completion time)

**Changes:**
- Modified `src/worktree/types.ts` - Added `commitsBehind?: number` to `WorktreeInfo`
- Modified `src/worktree/list.ts` - Propagated `detection.commitsBehind` to WorktreeInfo
- Modified `src/worktree/status-string.ts` - Added behind count display ("3 ahead, 2 behind", "2 behind", "2 behind, dirty")
- Modified `src/worktree/status-string.test.ts` - 8 new test cases for all format combinations
- Modified `src/worktree/list.test.ts` - Integration test for end-to-end propagation

**Key Decision:** A branch that is behind but has NO local commits is detected as `merged: true` by ancestor check, so the behind-only status string path is tested as a unit test without git.

### Task 10: Deduplicate getAheadBehindCounts (#21)

**Builder:** enterprise:builder-scotty (sonnet) - Agent ID: a94a9e9
**Result:** PASS - 333 tests

**Changes:**
- Created `src/worktree/git-counts.ts` - Shared `getAheadBehindCounts()` utility (65 lines)
- Created `src/worktree/git-counts.test.ts` - 9 tests (happy path, error cases, AbortSignal)
- Modified `src/worktree/merge-status.ts` - Removed local function, imported from git-counts
- Modified `src/worktree/status.ts` - Removed local `getAheadBehind` + `AheadBehind` interface, imported shared version
- Modified `src/worktree/index.ts` - Exported `getAheadBehindCounts`

**Key Decision:** The `isMain`/`(detached)` guard from `status.ts`'s version was inlined at the call site rather than in the shared utility, keeping the utility pure.

## Validation

**Validator:** enterprise:validator-mccoy (haiku) - Agent ID: ae1425d
**Result:** PASS

| Check | Result | Notes |
|-------|--------|-------|
| `bun test` | PASS | 333 tests, 0 failures |
| `bunx tsc --noEmit` | PASS | Clean |
| `bunx biome ci .` | PASS | Clean |
| DetectionIssue interface | PASS | 5 fields, 12 error codes |
| detectionError backward compat | PASS | Computed from issues via issuestoDetectionError |
| commitsBehind in WorktreeInfo | PASS | Propagated in list.ts |
| mergeMethod in WorktreeStatus | PASS | Propagated in status.ts |
| detectionError/issues on DeleteCheck | PASS | Propagated in delete.ts |
| mergeMethod on DeleteResult | PASS | Detected before removal |
| getAheadBehindCounts shared | PASS | Single source in git-counts.ts |
| getWorktreeBranches optimization | PASS | Avoids full enrichment |

## Rework Cycles
- 0 rework cycles needed. All 6 builders passed on first attempt.

## New Files Created
- `src/worktree/detection-issue.ts`
- `src/worktree/detection-issue.test.ts`
- `src/worktree/git-counts.ts`
- `src/worktree/git-counts.test.ts`

## Files Modified
- `src/worktree/merge-status.ts`
- `src/worktree/merge-status.test.ts`
- `src/worktree/types.ts`
- `src/worktree/list.ts`
- `src/worktree/list.test.ts`
- `src/worktree/orphans.ts`
- `src/worktree/orphans.test.ts`
- `src/worktree/status.ts`
- `src/worktree/status.test.ts`
- `src/worktree/status-string.ts`
- `src/worktree/status-string.test.ts`
- `src/worktree/delete.ts`
- `src/worktree/delete.test.ts`
- `src/worktree/index.ts`

## Status
COMPLETE - all 6 issues addressed, all tests passing.
