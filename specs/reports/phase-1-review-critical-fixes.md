# Phase 1 Report: Critical & High Severity Fixes

## Summary
Fixed 5 safety-critical bugs (#40-#44) including AbortSignal unhandled exceptions, env var parsing crashes, missing backup refs in clean, SIGTERM blocking shutdown, and missing changeset for breaking JSON change.

## Issues Closed
- #40: Add changeset for breaking JSON output shape -- created major changeset documenting `list --json` output change
- #41: AbortSignal try/catch in Layers 1/2 -- wrapped detection cascade in top-level try/catch for AbortError
- #42: SIGTERM handler graceful shutdown -- replaced process.exit(143) with process.exitCode = 143
- #43: cleanWorktrees backup refs -- added createBackupRef calls before all branch deletions
- #44: Env var validation -- created parseEnvInt helper, applied to all 5 bare Number() sites

## Builder Report: builder-critical

### Files Changed
- `src/worktree/env.ts` (new) -- parseEnvInt helper with NaN/0/negative rejection
- `src/worktree/env.test.ts` (new) -- 12 tests for parseEnvInt
- `.changeset/json-output-breaking-shape.md` (new) -- major changeset for @side-quest/git
- `src/worktree/detection-issue.ts` -- added DETECTION_ABORTED code
- `src/worktree/merge-status.ts` -- top-level AbortError try/catch, parseEnvInt usage
- `src/worktree/list.ts` -- replaced bare Number() with parseEnvInt
- `src/worktree/orphans.ts` -- replaced bare Number() with parseEnvInt
- `src/worktree/cli.ts` -- process.exitCode = 143 instead of process.exit(143)
- `src/worktree/clean.ts` -- createBackupRef before branch deletions
- `src/worktree/merge-status.test.ts` -- AbortError test
- `src/worktree/clean.test.ts` -- backup ref verification tests

### Implementation Decisions
- parseEnvInt defaults min to 1 when not specified, protecting against zero concurrency
- Layer 1/2 AbortError catch only catches err.name === 'AbortError'; other errors re-throw
- Backup ref creation is best-effort; failure logs warning but doesn't block deletion

### Issues Encountered
- None

### Agent Session
- Agent ID: abf2082
- Model: sonnet

## Validator Report: validator-phase

### Checks Performed
| Check | Result | Notes |
|-------|--------|-------|
| `bun test` | PASS | 423 tests passing |
| `bunx tsc --noEmit` | PASS | No type errors |
| `bunx biome ci .` | PASS | 111 files clean |
| AbortSignal handling | PASS | Pre-aborted signal returns DETECTION_ABORTED gracefully |
| Env var rejection | PASS | NaN/0/negative rejected with clear errors |
| Backup refs | PASS | createBackupRef called before all branch deletions |
| SIGTERM behavior | PASS | process.exitCode = 143, not process.exit(143) |
| Changeset | PASS | Exists with @side-quest/git major |

### Issues Found
- None

### Agent Session
- Agent ID: a2d1c20
- Model: haiku

## Rework Cycles
0 -- builder passed validation on first attempt

## Lessons Learned
- parseEnvInt helper is reusable across all env var sites; worth extracting early
- Best-effort pattern (try backup, log warning, continue deletion) is correct for cleanup operations

## Status
COMPLETE
