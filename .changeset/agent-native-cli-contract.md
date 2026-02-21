---
'@side-quest/git': major
---

Harden the `side-quest-git` CLI with agent-native contracts and strict invocation validation.

### Breaking changes

- Success output is now wrapped as `{ status: "ok", data: ... }`
- Errors are now wrapped on stderr as `{ status: "error", error: { code, name, message } }`
- Unknown flags now fail with `E_USAGE` and exit code `2` (previously ignored)
- `--help` output is now generated from a centralized command registry
- Binary entrypoint moved to `dist/worktree/cli/index.js`

### Added

- Typed exit codes and structured `CliError` model
- Global flags: `--jsonl`, `--quiet`, `--fields`, `--non-interactive`, `--help`
- `--fields` projection for token-efficient responses
- Modular command handlers under `src/worktree/cli/handlers/*`

### Migration

Update JSON consumers to read through `.data`:

```bash
# Before
bunx @side-quest/git worktree list --json | jq '.worktrees[]'

# After
bunx @side-quest/git worktree list --json | jq '.data.worktrees[]'
```
