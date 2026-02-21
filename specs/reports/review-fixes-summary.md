# Review Fixes Summary Report

## Overview
All 13 staff engineer review issues (#40-#52) have been addressed across 3 phases. A post-review hardening patch was also applied on 2026-02-20, followed by a focused follow-up hardening commit (`fb12223`). The codebase passes full validation with 438 tests, zero type errors, and zero lint errors.

## Issue Status

| Issue | Title | Severity | Status | Phase |
|-------|-------|----------|--------|-------|
| #40 | Changeset for breaking JSON output | Critical | DONE | 1 |
| #41 | AbortSignal try/catch in Layers 1/2 | Critical | DONE | 1 |
| #42 | SIGTERM handler graceful shutdown | High | DONE | 1 |
| #43 | cleanWorktrees backup refs | High | DONE | 1 |
| #44 | Env var validation helper | High | DONE | 1 |
| #45 | EPERM handling in isPidAlive | Medium | DONE | 2 |
| #46 | Backup ref refs/heads/ prefix | Medium | DONE | 2 |
| #47 | deleteWorktree try/catch around detection | Medium | DONE | 2 |
| #48 | process.exit(1) truncation fix | Medium | DONE | 2 |
| #49 | Dependabot workflow separation | Low | NO CODE CHANGE | 3 |
| #50 | Rename issuestoDetectionError | Low | DONE | 3 |
| #51 | Missing CLI tests | Low | DONE | 3 |
| #52 | Benchmark import.meta.main guard | Low | DONE | 3 |

## Validation Results

| Check | Result |
|-------|--------|
| `bun test` | 438 tests passing, 0 failures |
| `bunx tsc --noEmit` | Zero type errors |
| `bunx biome ci .` | Zero lint errors, 111 files checked |
| `bun run validate` | PASS (lint + types + build + test) |

## Post-Review Patch (2026-02-20)

Additional hardening changes applied after the initial #40-#52 fixes:

1. **Backup retention correctness**
   - `cleanupBackupRefs` now uses backup-ref reflog timestamps (ref-write time), not commit metadata time.
   - `createBackupRef` now uses `git update-ref --create-reflog`.
2. **Delete/check kill-switch consistency**
   - `checkBeforeDelete` and `deleteWorktree` now skip `checkIsShallow()` when `SIDE_QUEST_NO_DETECTION=1`.
3. **Exact worktree existence matching**
   - `checkBeforeDelete` now parses `git worktree list --porcelain` entries and matches exact `worktree` paths (fixes prefix-collision false positives).
4. **Benchmark CLI input hardening**
   - `detection-benchmark.ts` now validates `worktreeCount` as a non-negative integer.
   - Invalid values (e.g. `abc`, `-2`) now fail fast with a clear error instead of producing runtime TypeErrors.
   - Non-null assertions on benchmark branch arrays were removed; explicit guards now verify required branches exist before detection benchmarking.
5. **Explicit detection-code regression coverage**
   - `detection-issue.test.ts` now explicitly asserts `DETECTION_CODES.DETECTION_ABORTED` in the "all expected codes are present" test.

## Total Rework Cycles
0 across all 3 phases -- every builder passed validation on first attempt.

## Files Changed

### New Files
- `src/worktree/env.ts` -- parseEnvInt helper
- `src/worktree/env.test.ts` -- parseEnvInt tests
- `.changeset/json-output-breaking-shape.md` -- major changeset

### Modified Files
- `src/worktree/merge-status.ts` -- AbortSignal handling, env var parsing, EPERM handling, naming fix
- `src/worktree/merge-status.test.ts` -- AbortError tests, EPERM/ESRCH tests
- `src/worktree/cli.ts` -- SIGTERM handler, process.exit(1) fixes
- `src/worktree/cli.test.ts` -- --shallow-ok, recover, output flushing tests
- `src/worktree/clean.ts` -- backup refs before deletion
- `src/worktree/clean.test.ts` -- backup ref verification tests
- `src/worktree/backup.ts` -- refs/heads/ prefix, reflog-backed backup timestamps for retention
- `src/worktree/backup.test.ts` -- tag collision tests, reflog/retention regression coverage
- `src/worktree/delete.ts` -- try/catch around detection, exact porcelain path matching, kill-switch shallow-check skip
- `src/worktree/delete.test.ts` -- detection failure resilience tests, prefix-collision regression coverage
- `src/worktree/list.ts` -- parseEnvInt usage
- `src/worktree/orphans.ts` -- parseEnvInt usage
- `src/worktree/detection-issue.ts` -- DETECTION_ABORTED code
- `src/worktree/benchmarks/detection-benchmark.ts` -- import.meta.main guard + CLI arg validation and branch-presence guards
- `src/worktree/detection-issue.test.ts` -- explicit DETECTION_ABORTED assertion in expected-codes test

### Report Files
- `specs/reports/phase-1-review-critical-fixes.md`
- `specs/reports/phase-2-review-medium-fixes.md`
- `specs/reports/phase-3-review-hygiene-fixes.md`
- `specs/reports/review-fixes-summary.md`

## Lessons Learned
1. parseEnvInt helper pattern is reusable -- worth extracting early when multiple sites need validation
2. Best-effort pattern (try, warn, continue) is correct for cleanup/deletion operations
3. EPERM vs ESRCH distinction is critical for cross-platform process liveness checks
4. refs/heads/ prefix is standard git safety for unambiguous ref resolution
5. import.meta.main guard is essential for script/module dual-use files in Bun
6. process.exitCode + return is preferred over process.exit() to allow stream flushing

## Deferred Items
- #49: Dependabot workflow separation -- would require destructive git history rewrite. Will close with comment when PR merges.
