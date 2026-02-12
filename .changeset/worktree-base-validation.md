---
'@side-quest/git': minor
---

Add `--base` flag validation and improve worktree status reporting

- Validate `--base` flag input to prevent silent failures when provided without a ref
- Add `commitsAhead` and `status` fields to worktree info (`pristine`, `dirty`, `N ahead`, `merged`, `merged, dirty`)
- Surface dirty state on merged branches so safety checks stay accurate
