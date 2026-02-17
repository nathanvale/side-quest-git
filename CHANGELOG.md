# Changelog

## 0.4.1

### Patch Changes

- [#33](https://github.com/nathanvale/side-quest-git/pull/33) [`18a3a1d`](https://github.com/nathanvale/side-quest-git/commit/18a3a1d1875ac15b1da5b5f228c39a2cec50caf4) Thanks [@nathanvale](https://github.com/nathanvale)! - Fix safety and consistency issues from staff review of squash-merge detection v2

  - **Main-worktree safety**: `onError` handler in `listWorktrees()` now computes `isMain` from raw entry data instead of hardcoding `false`, preventing `cleanWorktrees` from accidentally targeting main if enrichment fails.
  - **Shallow-guard boundary**: `checkBeforeDelete()` now passes `isShallow` to `detectMergeStatus`, matching the behavior in `listWorktrees()` and `listOrphanBranches()`.
  - **Commit-count semantics**: Shallow guard returns `commitsAhead: -1` (unknown sentinel) instead of `0`, consistent with `onError` handlers and `OrphanBranch` contract.
  - **Changeset description**: Clarified that both `listWorktrees()` and `listOrphanBranches()` include `onError` handlers.

## 0.4.0

### Minor Changes

- [#13](https://github.com/nathanvale/side-quest-git/pull/13) [`04bb408`](https://github.com/nathanvale/side-quest-git/commit/04bb4088cafdf28da6e2bf7eeeded687b61d22f9) Thanks [@nathanvale](https://github.com/nathanvale)! - Harden squash-merge detection for production scale

  - **Concurrency cap**: `listWorktrees()` and `listOrphanBranches()` now use bounded parallel processing (chunkSize: 4) instead of unbounded `Promise.all`, preventing process storms with many worktrees. An `onError` handler in `listWorktrees()` returns degraded results instead of failing the entire operation.
  - **Shallow clone guard**: New `checkIsShallow()` helper detects shallow clones once per gitRoot. When shallow, detection returns `detectionError` instead of false negatives. Respects `SIDE_QUEST_NO_SQUASH_DETECTION` kill switch.
  - **mergeMethod audit trail**: `cleanWorktrees()` now propagates `mergeMethod` to all `CleanedWorktree` and `SkippedWorktree` output objects, enabling deletion audit trails.
  - **OrphanBranch enrichment**: `OrphanBranch` type now includes optional `mergeMethod` and `detectionError` fields, propagated from detection results.
  - **Error masking fix**: Orphan classification now checks `detectionError` before `commitsAhead === 0`, preventing detection failures from being silently classified as `pristine`. Errors map to `status: 'unknown'` with valid commit counts preserved.

  **Note**: Adds optional fields to `WorktreeInfo` and `OrphanBranch` types. Source-compatible in TypeScript, but strict JSON schema validators may need updating.

## 0.3.0

### Minor Changes

- [#11](https://github.com/nathanvale/side-quest-git/pull/11) [`9385a47`](https://github.com/nathanvale/side-quest-git/commit/9385a47f0e68e4fbec302c14fdaaccc3ba1cbd0a) Thanks [@nathanvale](https://github.com/nathanvale)! - Add squash-merge detection for worktree operations

  Worktree clean, delete, list, and orphan commands now detect squash-merged branches using a three-layer cascade: ancestor check, ahead/behind counts, and synthetic commit comparison via `git cherry`. This prevents branches that were squash-merged into main from being incorrectly flagged as unmerged.

  New modules:

  - `merge-status.ts` - shared merge detection with squash awareness
  - `status-string.ts` - pure status string formatter

  Removed duplicate merge-detection logic from `list.ts`, `delete.ts`, and `orphans.ts`.

## 0.2.0

### Minor Changes

- [#9](https://github.com/nathanvale/side-quest-git/pull/9) [`2ff038b`](https://github.com/nathanvale/side-quest-git/commit/2ff038b44bc16f8e69cd88ee58edb0c6138aaae8) Thanks [@nathanvale](https://github.com/nathanvale)! - Add `--base` flag validation and improve worktree status reporting

  - Validate `--base` flag input to prevent silent failures when provided without a ref
  - Add `commitsAhead` and `status` fields to worktree info (`pristine`, `dirty`, `N ahead`, `merged`, `merged, dirty`)
  - Surface dirty state on merged branches so safety checks stay accurate

## 0.1.0

### Minor Changes

- [#7](https://github.com/nathanvale/side-quest-git/pull/7) [`8e3ab09`](https://github.com/nathanvale/side-quest-git/commit/8e3ab09f64f6b163749bce15cdf23bd52dc098a1) Thanks [@nathanvale](https://github.com/nathanvale)! - Add worktree lifecycle and local event-bus observability capabilities.

  - Add worktree lifecycle commands for create/install/sync/status/orphan discovery/clean workflows.
  - Add a local HTTP + WebSocket event bus for CLI event emission and live event tailing.
  - Add watch-mode status UX for real-time worktree visibility during multi-branch development.

### Patch Changes

- [#7](https://github.com/nathanvale/side-quest-git/pull/7) [`8e3ab09`](https://github.com/nathanvale/side-quest-git/commit/8e3ab09f64f6b163749bce15cdf23bd52dc098a1) Thanks [@nathanvale](https://github.com/nathanvale)! - Harden worktree attach and event-bus safety behavior.

  - Bind the local event bus to `127.0.0.1` by default (with explicit hostname override).
  - Verify branch identity before attach-to-existing sync to prevent sanitized-path collisions.
  - Use a stable repo-root-derived cache key for event server discovery and CLI event emission.
  - Validate `worktree status --watch --interval` to reject invalid or non-positive values.

## 0.0.1

### Patch Changes

- [#4](https://github.com/nathanvale/side-quest-git/pull/4) [`f8ef380`](https://github.com/nathanvale/side-quest-git/commit/f8ef38044b0e4b6ceb5a948ddd2f456cfb51cbc0) Thanks [@nathanvale](https://github.com/nathanvale)! - fix(deps): bump @side-quest/core to ^0.3.1 to fix Bun-only exists import (side-quest-core#29, side-quest-core#31)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial release.
