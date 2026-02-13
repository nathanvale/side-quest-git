---
'@side-quest/git': minor
---

Add squash-merge detection for worktree operations

Worktree clean, delete, list, and orphan commands now detect squash-merged branches using a three-layer cascade: ancestor check, ahead/behind counts, and synthetic commit comparison via `git cherry`. This prevents branches that were squash-merged into main from being incorrectly flagged as unmerged.

New modules:
- `merge-status.ts` - shared merge detection with squash awareness
- `status-string.ts` - pure status string formatter

Removed duplicate merge-detection logic from `list.ts`, `delete.ts`, and `orphans.ts`.
