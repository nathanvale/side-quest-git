---
'@side-quest/git': major
---

Major worktree lifecycle hardening and observability release.

### Breaking change

`worktree list --json` output changed from a bare array to an object:

- `worktrees`: array of worktree entries (filtered by `--all` as before)
- `health`: enrichment health summary

When `--include-orphans` is supplied, output now also includes:

- `orphans`
- `orphanHealth`

### Added

- Operational safety controls for detection:
  - AbortSignal threading and timeout handling
  - Full kill switch (`SIDE_QUEST_NO_DETECTION=1`)
  - Per-item timeout guard (`SIDE_QUEST_ITEM_TIMEOUT_MS`)
  - SIGTERM temp-dir cleanup resilience
- Detection and lifecycle enhancements:
  - Structured detection issues (`issues`) with codes/severity
  - `mergeMethod` propagation across list/status/delete/clean paths
  - `commitsBehind` support in status strings
  - `upstreamGone` detection for deleted remote tracking refs
  - `--timeout` and `--shallow-ok` flags on detection-aware commands
- Recoverability improvements:
  - Backup refs before branch deletion (`refs/backup/<branch>`)
  - `worktree recover` command to list, restore, and clean up backup refs
  - Backup retention based on ref-write/reflog timestamps
- Performance and observability:
  - Configurable list/orphan concurrency
  - Health metadata (`allFailed`, degraded/fatal counts)
  - Detection benchmark tooling and debug logging hooks

### Migration

Update scripts that parsed the old raw list array:

```bash
# Before
bunx @side-quest/git worktree list --json | jq '.[]'

# After
bunx @side-quest/git worktree list --json | jq '.worktrees[]'
```
