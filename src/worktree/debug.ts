/**
 * Structured debug logger for worktree operations.
 *
 * Why: Console.log pollutes stdout (which carries JSON output). Writing
 * structured JSON to stderr keeps the stdout contract intact while giving
 * operators visibility into the detection cascade, enrichment loop, and
 * orphan processing without instrumenting production paths.
 *
 * Enabled via SIDE_QUEST_DEBUG=1 env var. All calls are zero-overhead
 * no-ops when the flag is absent -- the enabled flag is cached once at
 * module load time.
 *
 * @module worktree/debug
 */

/**
 * Whether debug logging is currently enabled.
 *
 * Cached at module load time so repeated calls have no env-lookup overhead.
 */
const _debugEnabled = process.env.SIDE_QUEST_DEBUG === '1'

/**
 * Emit a structured JSON log line to stderr.
 *
 * Each line is a self-contained JSON object with at minimum `event` and `ts`
 * fields. Additional key/value pairs from `data` are spread into the object.
 *
 * Why stderr: stdout carries the JSON contract for callers (e.g. CLI piped
 * output). Writing to stderr keeps the machine-readable output clean while
 * still surfacing debug lines in terminal sessions and log aggregators that
 * capture both streams.
 *
 * Why structured JSON: structured lines are trivially parseable with `jq`
 * or any log aggregator, and avoid the ambiguity of free-form text.
 *
 * @param event - Stable event name, e.g. 'detection:start', 'layer1:result'
 * @param data - Additional fields to include in the log line
 */
export function debugLog(event: string, data: Record<string, unknown>): void {
	if (!_debugEnabled) return
	const line = JSON.stringify({ event, ts: new Date().toISOString(), ...data })
	process.stderr.write(`${line}\n`)
}

/**
 * Returns whether debug logging is currently active.
 *
 * Why: Allows callers to skip expensive data construction when debug is off,
 * without duplicating the env-var check everywhere.
 *
 * @returns true if SIDE_QUEST_DEBUG=1, false otherwise
 */
export function isDebugEnabled(): boolean {
	return _debugEnabled
}
