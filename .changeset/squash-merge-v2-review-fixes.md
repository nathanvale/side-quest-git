---
"@side-quest/git": patch
---

Fix safety and consistency issues from staff review of squash-merge detection v2

- **Main-worktree safety**: `onError` handler in `listWorktrees()` now computes `isMain` from raw entry data instead of hardcoding `false`, preventing `cleanWorktrees` from accidentally targeting main if enrichment fails.
- **Shallow-guard boundary**: `checkBeforeDelete()` now passes `isShallow` to `detectMergeStatus`, matching the behavior in `listWorktrees()` and `listOrphanBranches()`.
- **Commit-count semantics**: Shallow guard returns `commitsAhead: -1` (unknown sentinel) instead of `0`, consistent with `onError` handlers and `OrphanBranch` contract.
- **Changeset description**: Clarified that both `listWorktrees()` and `listOrphanBranches()` include `onError` handlers.
