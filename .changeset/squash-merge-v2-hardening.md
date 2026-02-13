---
"@side-quest/git": minor
---

Harden squash-merge detection for production scale

- **Concurrency cap**: `listWorktrees()` and `listOrphanBranches()` now use bounded parallel processing (chunkSize: 4) instead of unbounded `Promise.all`, preventing process storms with many worktrees. An `onError` handler in `listWorktrees()` returns degraded results instead of failing the entire operation.
- **Shallow clone guard**: New `checkIsShallow()` helper detects shallow clones once per gitRoot. When shallow, detection returns `detectionError` instead of false negatives. Respects `SIDE_QUEST_NO_SQUASH_DETECTION` kill switch.
- **mergeMethod audit trail**: `cleanWorktrees()` now propagates `mergeMethod` to all `CleanedWorktree` and `SkippedWorktree` output objects, enabling deletion audit trails.
- **OrphanBranch enrichment**: `OrphanBranch` type now includes optional `mergeMethod` and `detectionError` fields, propagated from detection results.
- **Error masking fix**: Orphan classification now checks `detectionError` before `commitsAhead === 0`, preventing detection failures from being silently classified as `pristine`. Errors map to `status: 'unknown'` with valid commit counts preserved.

**Note**: Adds optional fields to `WorktreeInfo` and `OrphanBranch` types. Source-compatible in TypeScript, but strict JSON schema validators may need updating.
