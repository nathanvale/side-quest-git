# Plan: Close All Open GitHub Issues (#14-#31)

## Task Description

Implement all 18 open GitHub issues on `@side-quest/git`, ranging from operational hardening (timeouts, kill switches, temp-dir cleanup) to type enrichment (mergeMethod/detectionError propagation) and performance work (benchmarks, batching). These issues were filed during staff engineer review of the v0.4.x squash-merge hardening work and represent the remaining roadmap to production-grade reliability.

## Objective

When this plan is complete:
1. All 18 open issues (#14-#31) are resolved with code changes, tests, and passing validation
2. The detection cascade has full timeout/abort support at every layer
3. An incident-grade kill switch disables all detection (not just Layer 3)
4. Structured error model replaces free-text `detectionError` strings
5. `commitsBehind` is visible in status output
6. `upstreamGone` detection identifies deleted remote tracking branches
7. Performance benchmarks establish baselines for the detection cascade
8. All types are consistent: `mergeMethod` and `detectionError` propagated everywhere

## Problem Statement

The v0.4.x squash-merge hardening shipped with 18 deferred issues identified during multi-pass staff review. These span operational reliability (no per-item timeouts, no full kill switch, orphaned temp dirs), type consistency (missing fields on DeleteCheck/WorktreeStatus/CLI events), observability (no structured errors, no debug logging), and performance (no benchmarks, no batch optimization). The codebase works for happy-path usage but lacks the hardening needed for production scale.

## Solution Approach

Group the 18 issues into 5 phases by dependency and risk:

1. **Phase 1 - Operational Safety** (#14, #15, #17): Timeout/abort support, full kill switch, temp-dir cleanup. These are the highest-risk gaps -- a hung git process or missing kill switch can cause incidents.

2. **Phase 2 - Structured Error Model** (#18): Replace `detectionError?: string` with structured `DetectionIssue` type. This is foundational -- many other issues reference it.

3. **Phase 3 - Type Propagation & Enrichment** (#20, #21, #22, #23, #30): Add `commitsBehind` to status strings, deduplicate `getAheadBehindCounts`, propagate `mergeMethod` to WorktreeStatus and CLI events, add `detectionError` to DeleteCheck.

4. **Phase 4 - Detection Enhancements** (#19, #24, #28, #31): `upstreamGone` detection, configurable timeout, `--shallow-ok` flag, backup refs before branch deletion.

5. **Phase 5 - Performance & Observability** (#16, #25, #26, #27, #29): Fail non-zero on systemic failures, batch git cherry optimization, benchmarks, configurable concurrency, structured debug logging.

## Relevant Files

Use these files to complete the task:

**Core detection:**
- `src/worktree/merge-status.ts` -- Detection cascade (Layers 1-3), shallow guard, isolated object env. Touched by #14, #15, #18, #19, #24, #25, #28, #29.
- `src/worktree/types.ts` -- All shared types. Touched by #18, #20, #22, #23, #27, #30.

**Consumers:**
- `src/worktree/list.ts` -- `listWorktrees()` with parallel enrichment. Touched by #14, #16, #18, #21, #27.
- `src/worktree/orphans.ts` -- Orphan branch discovery. Touched by #14, #16, #18, #27.
- `src/worktree/clean.ts` -- Batch cleanup. Touched by #16, #22, #31.
- `src/worktree/delete.ts` -- `checkBeforeDelete()` and `deleteWorktree()`. Touched by #30, #31.
- `src/worktree/status.ts` -- `getWorktreeStatus()`. Touched by #21, #23.
- `src/worktree/status-string.ts` -- Pure status formatter. Touched by #20.
- `src/worktree/cli.ts` -- CLI entry point. Touched by #22, #24, #28.

**Events:**
- `src/events/types.ts` -- Event envelope types. Touched by #22.
- `src/events/emit.ts` -- Fire-and-forget emitter. Touched by #22.

**Upstream dependency:**
- `node_modules/@side-quest/core/dist/src/concurrency/index.js` -- `processInParallelChunks`. Referenced by #14, #27.

**Tests (co-located):**
- `src/worktree/merge-status.test.ts` -- Detection cascade tests
- `src/worktree/list.test.ts` -- List enrichment tests
- `src/worktree/orphans.test.ts` -- Orphan discovery tests
- `src/worktree/clean.test.ts` -- Batch cleanup tests
- `src/worktree/delete.test.ts` -- Delete/check tests
- `src/worktree/status.test.ts` -- Status command tests
- `src/worktree/status-string.test.ts` -- Status formatter tests
- `src/worktree/cli.test.ts` -- End-to-end CLI tests

### New Files
- `src/worktree/detection-issue.ts` -- Structured error model (#18)
- `src/worktree/benchmarks/detection-benchmark.ts` -- Performance benchmarks (#26)

## Implementation Phases

### Phase 1: Operational Safety (#14, #15, #17)

The highest-priority work. A hung git process (#14) or inability to fully disable detection (#15) can cause incidents. Orphaned temp dirs (#17) are a slower leak but still operational debt.

**#14 - Per-item and chunk-level timeout with AbortSignal:**
- Thread `AbortSignal` through `detectMergeStatus()` and all spawn calls
- Add `signal?: AbortSignal` to `DetectionOptions`
- Wrap Layers 1 and 2 spawn calls with abort support (currently only Layer 3 has timeout)
- Add per-chunk timeout to `processInParallelChunks` usage in `list.ts` and `orphans.ts`
- Add top-level deadline option for `listWorktrees()` and `cleanWorktrees()`

**#15 - Incident-grade kill switch for all detection:**
- Add `SIDE_QUEST_NO_DETECTION=1` env var that skips ALL layers (1, 2, 3) and shallow checks
- Keep existing `SIDE_QUEST_NO_SQUASH_DETECTION=1` for targeted Layer 3 disable
- When `NO_DETECTION=1`: return `{ merged: false, commitsAhead: -1, commitsBehind: -1, detectionError: 'detection disabled' }`

**#17 - Temp-dir cleanup resilience:**
- Add process signal handlers for SIGTERM to clean up `sq-git-objects-*` dirs
- Add tmpdir janitor: on startup, scan for stale `sq-git-objects-*` dirs older than 1 hour
- Include PID in temp dir name for stale detection: `sq-git-objects-<pid>-*`

### Phase 2: Structured Error Model (#18)

Foundational type change that other issues reference. Must land before Phase 3.

**#18 - Replace detectionError string with structured error model:**
- Create `DetectionIssue` interface:
  ```typescript
  interface DetectionIssue {
    code: string           // stable, grep-able (e.g., 'SHALLOW_CLONE', 'MERGE_BASE_FAILED')
    severity: 'warning' | 'error'
    source: string         // which layer/step (e.g., 'layer1', 'layer3-cherry', 'shallow-guard')
    message: string        // human-readable detail
    countsReliable: boolean // whether commitsAhead/Behind are trustworthy
  }
  ```
- Replace `detectionError?: string` with `issues?: readonly DetectionIssue[]` on all types
- Backward compat: keep `detectionError` as computed getter or add migration helper
- Update `MergeDetectionResult`, `WorktreeInfo`, `OrphanBranch`, `DeleteCheck`
- Optimize `listOrphanBranches`: use raw porcelain parse for branch set instead of full `listWorktrees()`

### Phase 3: Type Propagation & Enrichment (#20, #21, #22, #23, #30)

With the structured error model in place, propagate missing fields across all types.

**#30 - Add detectionError to DeleteCheck:**
- Add `detectionError` (or `issues` per #18) to `DeleteCheck` interface
- Propagate from `detectMergeStatus` result in `checkBeforeDelete()`
- Already partially done -- `delete.ts:57` calls `detectMergeStatus` but doesn't propagate error

**#23 - Add mergeMethod to WorktreeStatus:**
- Add `mergeMethod?: MergeMethod` to `WorktreeStatus`
- Populate from `listWorktrees()` enrichment data in `status.ts`

**#22 - Propagate mergeMethod to CLI event payloads:**
- Add `mergeMethod?: MergeMethod` to CLI event data types
- Update `worktree.cleaned` event to include per-item mergeMethod
- Update `worktree.deleted` event if available from check

**#20 - Display commitsBehind in status strings:**
- Add `commitsBehind` to `WorktreeInfo` type
- Propagate from detection result in `list.ts` enrichment
- Update `buildStatusString()` to include behind count (e.g., "3 ahead, 2 behind")
- Update `StatusInput` (already has optional `commitsBehind`)

**#21 - Deduplicate getAheadBehindCounts:**
- Extract shared `getAheadBehindCounts()` from `merge-status.ts`
- Create utility in a shared location (e.g., `src/worktree/git-counts.ts`)
- Replace duplicate in `status.ts` (`getAheadBehind()`)
- Both `merge-status.ts` and `status.ts` consume the shared version

### Phase 4: Detection Enhancements (#19, #24, #28, #31)

New detection capabilities and configuration options.

**#19 - upstreamGone detection (Layer 3 enhancement):**
- Add `upstreamGone?: boolean` to `WorktreeInfo` and `MergeDetectionResult`
- Use `git for-each-ref --format=%(upstream:track) refs/heads/<branch>` to detect `[gone]`
- Run as part of enrichment, not as a detection layer gate
- Useful signal: remote branch deleted (likely after PR merge on GitHub)

**#24 - Configurable squash detection timeout:**
- Add `SIDE_QUEST_DETECTION_TIMEOUT_MS` env var
- Add `--timeout` CLI flag for per-command override
- Default remains 5000ms
- Applies to Layer 3 cherry timeout and any new per-item timeouts from #14

**#28 - --shallow-ok flag for CI:**
- Add `SIDE_QUEST_SHALLOW_OK=1` env var
- Add `--shallow-ok` CLI flag
- Bypasses shallow clone guard, allowing detection to proceed in shallow clones
- User takes responsibility for depth being sufficient

**#31 - Backup refs before branch deletion:**
- Before `git branch -d/-D`, create `refs/backup/<branch>` pointing to the same commit
- Provides recovery path: `git checkout -b <branch> refs/backup/<branch>`
- Add `worktree recover` command to list and restore backed-up branches
- Auto-cleanup: backup refs older than 30 days (configurable)

### Phase 5: Performance & Observability (#16, #25, #26, #27, #29)

Performance optimization and operational observability.

**#27 - Configurable list concurrency:**
- Extract `chunkSize: 4` to shared constant `DEFAULT_CONCURRENCY = 4`
- Add `SIDE_QUEST_CONCURRENCY` env var
- Add `concurrency` option to `listWorktrees()`, `listOrphanBranches()`, `cleanWorktrees()`
- Remove magic number duplication

**#16 - Fail non-zero on systemic enrichment failures:**
- Add health metadata to JSON output: `{ degradedCount, fatalCount, allFailed }`
- CLI exits non-zero when all entries have enrichment failures
- Add `'enrichment failed'` to a typed status enum

**#25 - Batch git cherry optimization:**
- Investigate batching multiple branch checks into fewer git operations
- Profile to determine if subprocess overhead is the bottleneck
- If beneficial, batch `git cherry` calls for branches sharing the same merge-base

**#26 - Performance benchmarks:**
- Add benchmark suite measuring:
  - `detectMergeStatus` per-branch latency (ancestor vs squash vs unmerged)
  - `listWorktrees` end-to-end with N worktrees (5, 10, 20)
  - Peak subprocess count per chunk
  - Impact of chunkSize on wall time
- Use `Bun.bench` or `performance.now()` for measurement

**#29 - Structured debug logging:**
- Add structured logging capturing detection layer failures
- Include: which layer, exit codes, stderr, timing, shallow status
- Integrate with `DetectionIssue` from #18
- Optional: `SIDE_QUEST_DEBUG=1` to enable verbose logging

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. Use Task and Task* tools only.
- Take note of the session id (agentId) of each team member for resume operations.

### Execution Reports

After each phase completes (builder + validator cycle), the team lead MUST write a report to `specs/reports/`. Reports are the durable record of what happened -- what was built, what was validated, what went wrong, and what was learned.

**Directory:** `specs/reports/`

**Naming:** `phase-<N>-<slug>.md` (e.g., `phase-1-operational-safety.md`)

**Report format:**

```markdown
# Phase <N> Report: <Phase Name>

## Summary
<1-2 sentence overview of what this phase accomplished>

## Issues Closed
- #<N>: <title> -- <one-line summary of what was done>

## Builder Report: <builder-name>

### Files Changed
<list of files created/modified with brief description of changes>

### Implementation Decisions
<any design decisions made during implementation that deviated from or refined the plan>

### Issues Encountered
<problems hit during implementation, how they were resolved>
- <issue>: <resolution>

### Agent Session
- Agent ID: <agentId for resume>
- Model: sonnet
- Turns used: <approximate>

## Validator Report: <validator-name>

### Checks Performed
| Check | Result | Notes |
|-------|--------|-------|
| `bun test` | PASS/FAIL | <details if failed> |
| `bunx tsc --noEmit` | PASS/FAIL | <details if failed> |
| `bunx biome ci .` | PASS/FAIL | <details if failed> |
| <specific verification> | PASS/FAIL | <details> |

### Issues Found
<any problems the validator caught that required builder fixes>
- <issue>: <resolution / still open>

### Agent Session
- Agent ID: <agentId for resume>
- Model: haiku
- Turns used: <approximate>

## Rework Cycles
<number of builder-validator round trips needed>
- Cycle 1: <what happened>
- Cycle 2: <what happened> (if any)

## Lessons Learned
<anything that should inform future phases or plans>

## Status
<COMPLETE / PARTIAL -- list any unfinished items>
```

**Final report:** After all phases, write `specs/reports/final-summary.md` with:
- Overall status (all 18 issues)
- Total rework cycles across all phases
- Aggregate lessons learned
- Any issues that were descoped or deferred
- Full validation results

### Git Workflow Per Task

Each task MUST produce exactly **one squashed commit** with a comprehensive message. No multi-commit sprawl.

**During task execution:**
- Builders use `/git:checkpoint` freely to save WIP progress (safe, skips hooks)
- Multiple checkpoints are expected and encouraged during implementation

**When a task is complete (builder done + validator passed):**
1. Write the phase report to `specs/reports/phase-<N>-<slug>.md`
2. Stage the report alongside the code changes
3. Use `/git:squash` to collapse all WIP checkpoint commits into one clean commit
4. The squashed commit message MUST follow this format:

```
<type>(<scope>): <subject> (#<issue numbers>)

<body explaining what was done and why>

Report: specs/reports/phase-<N>-<slug>.md
Closes #<issue> #<issue> ...
```

**Example:**
```
feat(worktree): add per-item timeout and incident kill switch (#14, #15, #17)

- Thread AbortSignal through all spawn calls in detection cascade
- Add SIDE_QUEST_NO_DETECTION=1 full kill switch (bypasses all layers)
- Add PID-tagged temp dirs with stale cleanup janitor
- Keep SIDE_QUEST_NO_SQUASH_DETECTION=1 backward compat

Report: specs/reports/phase-1-operational-safety.md
Closes #14 #15 #17
```

**Rules:**
- One commit per task (or per phase if tasks are tightly coupled)
- NEVER leave WIP checkpoint commits in the final history
- The commit message references the report file so reviewers can find the full context
- Use `/git:commit` for the final commit if no squashing is needed (single-commit task)
- Use `/git:squash` when there are multiple WIP checkpoints to collapse

### Model Selection Guide

| Role | Model | Rationale |
|------|-------|-----------|
| All builders | sonnet | Executes well-specified tasks reliably |
| All validators | haiku | Mechanical checks: read files, run commands, report PASS/FAIL |

### Team Members

- Builder
  - Name: builder-safety
  - Role: Implement operational safety features (#14 timeout/abort, #15 kill switch, #17 temp-dir cleanup)
  - Agent Type: enterprise:builder-scotty
  - Model: sonnet
  - Resume: true

- Builder
  - Name: builder-types
  - Role: Implement structured error model (#18) and type propagation (#20, #21, #22, #23, #30)
  - Agent Type: enterprise:builder-scotty
  - Model: sonnet
  - Resume: true

- Builder
  - Name: builder-detection
  - Role: Implement detection enhancements (#19 upstreamGone, #24 timeout config, #28 shallow-ok, #31 backup refs)
  - Agent Type: enterprise:builder-scotty
  - Model: sonnet
  - Resume: true

- Builder
  - Name: builder-perf
  - Role: Implement performance and observability features (#16 fail non-zero, #25 batch cherry, #26 benchmarks, #27 concurrency config, #29 debug logging)
  - Agent Type: enterprise:builder-scotty
  - Model: sonnet
  - Resume: true

- Validator
  - Name: validator-phase
  - Role: Validate each phase after builders complete (types, tests, lint, runtime behavior)
  - Agent Type: enterprise:validator-mccoy
  - Model: haiku
  - Resume: true

- Validator
  - Name: validator-final
  - Role: Run full validation suite and verify all 18 issues are addressed
  - Agent Type: enterprise:validator-mccoy
  - Model: haiku
  - Resume: true

## Step-by-step Tasks

- Execute every step in order, top to bottom.
- Before starting, run TaskCreate for each task so all team members can see the full plan.

### 1. Add per-item and chunk-level timeout with AbortSignal (#14)
- **Task ID**: safety-timeout-abort
- **Depends On**: none
- **Assigned To**: builder-safety
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Add `signal?: AbortSignal` to `DetectionOptions` in `merge-status.ts`
- Thread signal through all `spawnAndCollect` calls in Layers 1, 2
- For Layer 3: connect existing `spawnWithTimeout` to signal as well
- In `list.ts`: wrap each `enrichWorktreeInfo` call with `AbortSignal.timeout(perItemMs)` (default 10000ms)
- In `orphans.ts`: same pattern for `detectMergeStatus` calls
- Add `SIDE_QUEST_ITEM_TIMEOUT_MS` env var (default 10000)
- Add tests: verify timeout triggers for slow detection, verify signal propagation
- Do NOT modify `@side-quest/core` -- work within the existing `processInParallelChunks` API

### 2. Add incident-grade kill switch (#15)
- **Task ID**: safety-kill-switch
- **Depends On**: none
- **Assigned To**: builder-safety
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with task 1)
- In `merge-status.ts`: add early return when `SIDE_QUEST_NO_DETECTION === '1'`
- Return `{ merged: false, commitsAhead: -1, commitsBehind: -1, detectionError: 'detection disabled' }`
- This must be checked BEFORE the shallow guard and before any layer
- In `list.ts`: when `NO_DETECTION=1`, skip `checkIsShallow()` call too
- In `orphans.ts`: same
- Add tests: verify all detection layers are bypassed, verify return shape

### 3. Add temp-dir cleanup resilience (#17)
- **Task ID**: safety-tempdir-cleanup
- **Depends On**: none
- **Assigned To**: builder-safety
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with tasks 1, 2)
- In `merge-status.ts`: change temp dir prefix to include PID: `sq-git-objects-${process.pid}-`
- Add `cleanupStaleTempDirs()` function that scans tmpdir for `sq-git-objects-*` dirs older than 1 hour
- Call `cleanupStaleTempDirs()` at the start of `detectMergeStatus()` (debounced -- once per process, not per call)
- Add SIGTERM handler in `cli.ts` that cleans up any active temp dirs
- Add tests: verify stale dir cleanup, verify PID naming

### 4. Validate Phase 1 (Operational Safety)
- **Task ID**: validate-phase-1
- **Depends On**: safety-timeout-abort, safety-kill-switch, safety-tempdir-cleanup
- **Assigned To**: validator-phase
- **Agent Type**: enterprise:validator-mccoy
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- lint clean
- Verify `SIDE_QUEST_NO_DETECTION=1` fully bypasses detection
- Verify `SIDE_QUEST_NO_SQUASH_DETECTION=1` still works (backward compat)
- Verify AbortSignal is threaded through detection calls
- Verify temp dir naming includes PID

### 5. Implement structured error model (#18)
- **Task ID**: types-structured-errors
- **Depends On**: validate-phase-1
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Create `src/worktree/detection-issue.ts` with `DetectionIssue` interface and error code constants
- Define error codes: `SHALLOW_CLONE`, `SHALLOW_CHECK_FAILED`, `MERGE_BASE_FAILED`, `MERGE_BASE_LOOKUP_FAILED`, `CHERRY_TIMEOUT`, `CHERRY_FAILED`, `CHERRY_EMPTY`, `CHERRY_INVALID`, `COMMIT_TREE_FAILED`, `GIT_PATH_FAILED`, `DETECTION_DISABLED`, `ENRICHMENT_FAILED`
- Update `MergeDetectionResult` to include `issues?: readonly DetectionIssue[]` alongside `detectionError`
- Keep `detectionError?: string` for backward compatibility (computed from first issue's message)
- Update all error paths in `merge-status.ts` to create `DetectionIssue` objects
- Update `WorktreeInfo`, `OrphanBranch` types to include `issues?: readonly DetectionIssue[]`
- Optimize `listOrphanBranches`: use raw `git worktree list --porcelain` parsing for branch set instead of full `listWorktrees()` enrichment
- Add tests for structured error creation and backward compat

### 6. Add detectionError to DeleteCheck (#30)
- **Task ID**: types-deletecheck-error
- **Depends On**: types-structured-errors
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Add `detectionError?: string` and `issues?: readonly DetectionIssue[]` to `DeleteCheck` in `delete.ts`
- Propagate from `detectMergeStatus` result in `checkBeforeDelete()`
- Add test: verify detection error surfaces in check output

### 7. Add mergeMethod to WorktreeStatus (#23)
- **Task ID**: types-status-mergemethod
- **Depends On**: types-structured-errors
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with task 6)
- Add `mergeMethod?: MergeMethod` to `WorktreeStatus` in `types.ts`
- In `status.ts`: get `mergeMethod` from the `listWorktrees()` enrichment data (`WorktreeInfo.mergeMethod`)
- Add test: verify mergeMethod appears in status output

### 8. Propagate mergeMethod to CLI event payloads (#22)
- **Task ID**: types-event-mergemethod
- **Depends On**: types-status-mergemethod
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- In `src/events/types.ts`: add `mergeMethod` to relevant event data types
- In `cli.ts`: the `worktree.cleaned` event already passes `CleanResult` which has `mergeMethod` on `CleanedWorktree` -- verify it's included
- For `worktree.deleted`: add optional check data to event payload
- Add test or verify existing event emission includes mergeMethod

### 9. Display commitsBehind in status strings (#20)
- **Task ID**: types-commits-behind
- **Depends On**: types-structured-errors
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with tasks 6, 7, 8)
- Add `commitsBehind?: number` to `WorktreeInfo` in `types.ts`
- In `list.ts` `enrichWorktreeInfo()`: populate `commitsBehind` from detection result
- In `status-string.ts` `buildStatusString()`: include behind count when > 0 (e.g., "3 ahead, 2 behind" or "2 behind, dirty")
- Update `StatusInput` -- `commitsBehind` is already optional, no change needed
- Add status-string tests for new format combinations

### 10. Deduplicate getAheadBehindCounts (#21)
- **Task ID**: types-dedup-counts
- **Depends On**: types-commits-behind
- **Assigned To**: builder-types
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Extract `getAheadBehindCounts()` from `merge-status.ts` to `src/worktree/git-counts.ts`
- Replace `getAheadBehind()` in `status.ts` with the shared version
- Import shared version in `merge-status.ts`
- Ensure both consumers work identically (same parsing, same fallback behavior)
- Add JSDoc to shared function
- Add tests for the shared utility

### 11. Validate Phase 2+3 (Structured Errors + Type Propagation)
- **Task ID**: validate-phase-2-3
- **Depends On**: types-deletecheck-error, types-event-mergemethod, types-dedup-counts
- **Assigned To**: validator-phase
- **Agent Type**: enterprise:validator-mccoy
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- lint clean
- Verify `DetectionIssue` type exists with code/severity/source/message/countsReliable
- Verify `detectionError` still works (backward compat)
- Verify `commitsBehind` appears in `WorktreeInfo`
- Verify `mergeMethod` appears in `WorktreeStatus`
- Verify `detectionError`/`issues` on `DeleteCheck`
- Verify `getAheadBehindCounts` is shared (not duplicated)

### 12. Add upstreamGone detection (#19)
- **Task ID**: detection-upstream-gone
- **Depends On**: validate-phase-2-3
- **Assigned To**: builder-detection
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Add `upstreamGone?: boolean` to `WorktreeInfo` and `OrphanBranch`
- Create `checkUpstreamGone(gitRoot, branch)` utility using `git for-each-ref --format=%(upstream:track) refs/heads/<branch>`
- Parse output for `[gone]` indicator
- Call during enrichment in `list.ts` (after detection, lightweight single git call)
- Call during orphan classification in `orphans.ts`
- Add tests with a branch whose remote tracking ref has been deleted

### 13. Make squash detection timeout configurable (#24)
- **Task ID**: detection-timeout-config
- **Depends On**: validate-phase-2-3
- **Assigned To**: builder-detection
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with task 12)
- Read `SIDE_QUEST_DETECTION_TIMEOUT_MS` env var in `merge-status.ts`
- Add `--timeout <ms>` flag to relevant CLI commands (list, clean, orphans, check)
- Pass through to `DetectionOptions.timeout`
- Default remains 5000ms
- Add test: verify custom timeout value is respected

### 14. Add --shallow-ok flag (#28)
- **Task ID**: detection-shallow-ok
- **Depends On**: validate-phase-2-3
- **Assigned To**: builder-detection
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with tasks 12, 13)
- Add `SIDE_QUEST_SHALLOW_OK=1` env var support in `merge-status.ts`
- Add `--shallow-ok` CLI flag to list, clean, orphans, check commands
- When active: skip the shallow guard, proceed with detection
- Add `shallowOk?: boolean` to `DetectionOptions`
- Add test: verify detection proceeds in shallow clone with flag set

### 15. Add backup refs before branch deletion (#31)
- **Task ID**: detection-backup-refs
- **Depends On**: validate-phase-2-3
- **Assigned To**: builder-detection
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with tasks 12, 13, 14)
- Create `src/worktree/backup.ts` with `createBackupRef(gitRoot, branch)` and `listBackupRefs(gitRoot)` and `restoreBackupRef(gitRoot, branch)`
- In `delete.ts`: call `createBackupRef()` before `git branch -d/-D`
- In `clean.ts`: call `createBackupRef()` before each branch deletion
- Ref format: `refs/backup/<branch>` pointing to the branch tip commit
- Add `worktree recover` CLI subcommand to list and restore backed-up branches
- Add auto-cleanup: `cleanupOldBackupRefs(gitRoot, maxAgeDays)` removes refs older than 30 days
- Add tests: verify backup ref created, verify restore works, verify cleanup

### 16. Validate Phase 4 (Detection Enhancements)
- **Task ID**: validate-phase-4
- **Depends On**: detection-upstream-gone, detection-timeout-config, detection-shallow-ok, detection-backup-refs
- **Assigned To**: validator-phase
- **Agent Type**: enterprise:validator-mccoy
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- lint clean
- Verify `upstreamGone` field on `WorktreeInfo`
- Verify `--timeout`, `--shallow-ok` CLI flags
- Verify `SIDE_QUEST_DETECTION_TIMEOUT_MS` and `SIDE_QUEST_SHALLOW_OK` env vars
- Verify `worktree recover` subcommand exists
- Verify backup refs created before branch deletion

### 17. Make list concurrency configurable (#27)
- **Task ID**: perf-concurrency-config
- **Depends On**: validate-phase-4
- **Assigned To**: builder-perf
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Extract `chunkSize: 4` to `const DEFAULT_CONCURRENCY = 4` in a shared location
- Add `SIDE_QUEST_CONCURRENCY` env var
- Add `concurrency?: number` option to `listWorktrees()`, `listOrphanBranches()`, `cleanWorktrees()`
- Update `list.ts`, `orphans.ts` to use configurable value
- `status.ts` already has `concurrency` option -- ensure consistency
- Add test: verify custom concurrency value is respected

### 18. Fail non-zero on systemic enrichment failures (#16)
- **Task ID**: perf-fail-nonzero
- **Depends On**: validate-phase-4
- **Assigned To**: builder-perf
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: true (with task 17)
- Add health metadata to `listWorktrees()` return: `{ worktrees, metadata: { degradedCount, fatalCount, allFailed } }`
- Or: add health metadata alongside the array in CLI JSON output
- In `cli.ts`: exit non-zero when `allFailed === true` or `degradedCount === worktrees.length`
- Add `'enrichment-failed'` to a typed enum for status field
- In `orphans.ts`: same pattern for systemic failure
- Add test: verify exit code 1 when all enrichments fail

### 19. Batch git cherry optimization (#25)
- **Task ID**: perf-batch-cherry
- **Depends On**: perf-concurrency-config
- **Assigned To**: builder-perf
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Profile current behavior: measure subprocess count and timing for 5, 10, 20 branches
- If branches share the same merge-base, batch their cherry checks
- Alternatively: investigate if `git cherry` can be called with multiple refs
- Add benchmark results as comments/docs
- If optimization is not measurably beneficial, document the finding and close as "won't fix"

### 20. Add performance benchmarks (#26)
- **Task ID**: perf-benchmarks
- **Depends On**: perf-batch-cherry
- **Assigned To**: builder-perf
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Create `src/worktree/benchmarks/detection-benchmark.ts`
- Measure:
  - `detectMergeStatus` latency per merge method (ancestor, squash, unmerged)
  - `listWorktrees` end-to-end with 5, 10, 20 worktrees
  - Peak subprocess count per chunk
  - Wall time vs chunkSize (1, 2, 4, 8)
- Use `performance.now()` for timing
- Output results as JSON for comparison
- Add `bun run benchmark` script to `package.json`

### 21. Add structured debug logging (#29)
- **Task ID**: perf-debug-logging
- **Depends On**: perf-benchmarks
- **Assigned To**: builder-perf
- **Agent Type**: enterprise:builder-scotty
- **Model**: sonnet
- **Parallel**: false
- Add `SIDE_QUEST_DEBUG=1` env var to enable verbose logging
- In `merge-status.ts`: log each layer entry/exit with timing, exit codes, stderr
- In `list.ts`/`orphans.ts`: log enrichment progress (N/total)
- Use structured JSON format to stderr (not stdout -- preserve JSON contract)
- Integrate with `DetectionIssue` from #18: issues array captures what went wrong, debug logs capture the full trace
- Add test: verify debug output appears when enabled, silent when disabled

### 22. Final Validation
- **Task ID**: validate-all
- **Depends On**: validate-phase-4, perf-fail-nonzero, perf-batch-cherry, perf-benchmarks, perf-debug-logging
- **Assigned To**: validator-final
- **Agent Type**: enterprise:validator-mccoy
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- lint clean
- Verify all 18 issues are addressed:
  - #14: AbortSignal support in detection
  - #15: `SIDE_QUEST_NO_DETECTION=1` kill switch
  - #16: Non-zero exit on systemic failures
  - #17: Temp-dir cleanup with PID naming
  - #18: `DetectionIssue` structured errors
  - #19: `upstreamGone` field on WorktreeInfo
  - #20: `commitsBehind` in status strings
  - #21: Shared `getAheadBehindCounts` utility
  - #22: `mergeMethod` in CLI event payloads
  - #23: `mergeMethod` in WorktreeStatus
  - #24: Configurable detection timeout
  - #25: Batch cherry optimization (or documented "won't fix")
  - #26: Performance benchmarks exist and run
  - #27: Configurable concurrency
  - #28: `--shallow-ok` flag
  - #29: Structured debug logging
  - #30: `detectionError` on DeleteCheck
  - #31: Backup refs before branch deletion
- Verify no breaking changes to existing CLI JSON contracts
- Verify backward compatibility of `detectionError` string field

## Acceptance Criteria

1. `SIDE_QUEST_NO_DETECTION=1` fully disables all detection layers
2. `SIDE_QUEST_NO_SQUASH_DETECTION=1` still disables only Layer 3 (backward compat)
3. AbortSignal is threaded through all spawn calls in detection cascade
4. Per-item timeout prevents hung enrichment from blocking entire list
5. Temp dirs include PID in name and stale dirs are cleaned up
6. `DetectionIssue` type provides structured error codes, severity, source
7. `detectionError` string still works (backward compat from `issues`)
8. `commitsBehind` appears in `WorktreeInfo` and status strings
9. `mergeMethod` appears in `WorktreeStatus` and CLI event payloads
10. `detectionError`/`issues` appears on `DeleteCheck`
11. `getAheadBehindCounts` is deduplicated into a shared utility
12. `upstreamGone` detection identifies deleted remote tracking branches
13. Detection timeout is configurable via env var and CLI flag
14. `--shallow-ok` bypasses shallow clone guard
15. Backup refs are created before branch deletion with recovery command
16. `SIDE_QUEST_CONCURRENCY` env var controls parallel chunk size
17. CLI exits non-zero when all enrichments fail
18. Performance benchmarks exist and can be run
19. `SIDE_QUEST_DEBUG=1` enables structured debug logging
20. Batch cherry optimization is implemented or documented as not beneficial
21. All tests pass: `bun test`
22. No type errors: `bunx tsc --noEmit`
23. No lint errors: `bunx biome ci .`

## Validation Commands
- `bun test` -- run all tests
- `bunx tsc --noEmit` -- verify no type errors
- `bunx biome ci .` -- lint and format check
- `bun run validate` -- full quality check

## Notes

### Backward Compatibility Strategy

The structured error model (#18) is the biggest breaking risk. Strategy:
- Keep `detectionError?: string` on all types as a computed field (first issue's message)
- Add `issues?: readonly DetectionIssue[]` alongside it
- Consumers that grep for specific error strings will still work
- New consumers use the structured `issues` array

### Environment Variables Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIDE_QUEST_NO_DETECTION` | unset | Full kill switch -- disables all layers |
| `SIDE_QUEST_NO_SQUASH_DETECTION` | unset | Targeted -- disables Layer 3 only |
| `SIDE_QUEST_DETECTION_TIMEOUT_MS` | `5000` | Layer 3 cherry timeout |
| `SIDE_QUEST_ITEM_TIMEOUT_MS` | `10000` | Per-item enrichment timeout |
| `SIDE_QUEST_CONCURRENCY` | `4` | Parallel chunk size |
| `SIDE_QUEST_SHALLOW_OK` | unset | Bypass shallow clone guard |
| `SIDE_QUEST_DEBUG` | unset | Enable structured debug logging |

### Cross-Repo Considerations

- `processInParallelChunks` lives in `@side-quest/core`. #14 works within its existing API (wrapping individual calls with AbortSignal) rather than modifying core.
- If core needs changes (e.g., per-chunk timeout), that's a separate PR to `@side-quest/core` that should be coordinated.

### Issue Dependencies (Internal)

```
#18 (structured errors) blocks #30 (DeleteCheck errors), affects #29 (debug logging)
#14 (timeout) and #24 (configurable timeout) are related but independent
#20 (commitsBehind) depends on #21 (dedup counts) for clean implementation
#31 (backup refs) is fully independent
#25 (batch cherry) depends on #26 (benchmarks) for measurement
```

### Source Context

- Original lifecycle spec: `/Users/nathanvale/code/side-quest-plugins/specs/side-quest-git-worktree-lifecycle.md`
- Migration spec: `/Users/nathanvale/code/side-quest-plugins/specs/dotfiles-worktree-migration.md`
- Review documents: `specs/reviews/squash-merge-v2-review-pass-{1,2,3}.md`
