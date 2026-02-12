# Changelog

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
