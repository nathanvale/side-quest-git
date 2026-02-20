---
'@side-quest/git': major
---

Breaking: `worktree list --json` output changed from a bare array to `{ worktrees, health }`.

Previously the command emitted a raw JSON array of worktree objects. It now emits a structured object with two keys:

- `worktrees` - the array of worktree objects (filtered by `--all` as before)
- `health` - a health summary object indicating whether all enrichments succeeded

When `--include-orphans` is supplied the response also includes `orphans` and `orphanHealth` keys.

**Migration:** Update any scripts that parse the raw array output:

```bash
# Before
bunx @side-quest/git worktree list --json | jq '.[]'

# After
bunx @side-quest/git worktree list --json | jq '.worktrees[]'
```
