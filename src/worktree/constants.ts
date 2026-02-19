/**
 * Shared constants for the worktree module.
 *
 * Centralised here so callers and tests can import the canonical values
 * without hard-coding magic numbers.
 */

/**
 * Default number of worktrees or branches to process in parallel.
 *
 * Why 4: enough parallelism to hide git subprocess latency on most machines
 * without flooding the file-descriptor pool or starving the OS scheduler.
 * Override per-call via the `concurrency` option or globally via the
 * `SIDE_QUEST_CONCURRENCY` environment variable.
 */
export const DEFAULT_CONCURRENCY = 4
