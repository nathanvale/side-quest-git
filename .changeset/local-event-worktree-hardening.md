---
'@side-quest/git': patch
---

Harden worktree attach and event-bus safety behavior.

- Bind the local event bus to `127.0.0.1` by default (with explicit hostname override).
- Verify branch identity before attach-to-existing sync to prevent sanitized-path collisions.
- Use a stable repo-root-derived cache key for event server discovery and CLI event emission.
- Validate `worktree status --watch --interval` to reject invalid or non-positive values.
