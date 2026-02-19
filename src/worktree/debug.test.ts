/**
 * Tests for the structured debug logger.
 *
 * Strategy: The `_debugEnabled` flag is cached at module load time, so we
 * cannot flip it within the same process. Instead:
 * - Disabled-state tests run inline (the test process does not set the env var)
 * - Enabled-state tests run in a child process with SIDE_QUEST_DEBUG=1 set
 *   before the module is first imported, so the flag is cached as true
 */
import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { debugLog, isDebugEnabled } from './debug.js'

// ---------------------------------------------------------------------------
// Disabled state (inline -- this process has no SIDE_QUEST_DEBUG set)
// ---------------------------------------------------------------------------

describe('debugLog (disabled)', () => {
	test('isDebugEnabled returns false when SIDE_QUEST_DEBUG is unset', () => {
		// Guard: ensure this test file itself is not run with SIDE_QUEST_DEBUG=1
		expect(process.env.SIDE_QUEST_DEBUG).not.toBe('1')
		expect(isDebugEnabled()).toBe(false)
	})

	test('produces no output on stderr when disabled', () => {
		// Capture by intercepting stderr.write.
		// We save and restore so other tests are unaffected.
		const writes: string[] = []
		const originalWrite = process.stderr.write.bind(process.stderr)
		const stderrSpy = process.stderr as unknown as {
			write: (chunk: string) => boolean
		}
		stderrSpy.write = (chunk: string) => {
			writes.push(chunk)
			return true
		}
		try {
			debugLog('test:event', { foo: 'bar' })
		} finally {
			stderrSpy.write = originalWrite as unknown as (chunk: string) => boolean
		}
		expect(writes).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// Enabled state (child process with SIDE_QUEST_DEBUG=1)
// ---------------------------------------------------------------------------

/**
 * Inline script that imports debug.ts and calls debugLog, then exits.
 * We run it as a subprocess with SIDE_QUEST_DEBUG=1 so the module-level
 * flag is cached as enabled from the first import.
 */
const PROBE_SCRIPT = `
import { debugLog, isDebugEnabled } from ${JSON.stringify(path.join(import.meta.dir, 'debug.js'))};
const enabled = isDebugEnabled();
process.stdout.write(JSON.stringify({ enabled }) + '\\n');
debugLog('probe:event', { alpha: 1, beta: 'two' });
`

describe('debugLog (enabled via SIDE_QUEST_DEBUG=1)', () => {
	test('isDebugEnabled returns true when SIDE_QUEST_DEBUG=1', async () => {
		const result = await spawnAndCollect(['bun', '--eval', PROBE_SCRIPT], {
			env: { ...process.env, SIDE_QUEST_DEBUG: '1' },
		})
		expect(result.exitCode).toBe(0)
		const stdoutLine = result.stdout.trim()
		const parsed = JSON.parse(stdoutLine) as { enabled: boolean }
		expect(parsed.enabled).toBe(true)
	})

	test('emits a JSON line on stderr with event and ts fields', async () => {
		const result = await spawnAndCollect(['bun', '--eval', PROBE_SCRIPT], {
			env: { ...process.env, SIDE_QUEST_DEBUG: '1' },
		})
		expect(result.exitCode).toBe(0)
		const stderrLine = result.stderr.trim()
		expect(stderrLine).toBeTruthy()
		const parsed = JSON.parse(stderrLine) as Record<string, unknown>
		expect(parsed.event).toBe('probe:event')
		expect(typeof parsed.ts).toBe('string')
	})

	test('spreads additional data fields into the log line', async () => {
		const result = await spawnAndCollect(['bun', '--eval', PROBE_SCRIPT], {
			env: { ...process.env, SIDE_QUEST_DEBUG: '1' },
		})
		expect(result.exitCode).toBe(0)
		const stderrLine = result.stderr.trim()
		const parsed = JSON.parse(stderrLine) as Record<string, unknown>
		expect(parsed.alpha).toBe(1)
		expect(parsed.beta).toBe('two')
	})

	test('ts field is a valid ISO 8601 date string', async () => {
		const result = await spawnAndCollect(['bun', '--eval', PROBE_SCRIPT], {
			env: { ...process.env, SIDE_QUEST_DEBUG: '1' },
		})
		expect(result.exitCode).toBe(0)
		const stderrLine = result.stderr.trim()
		const parsed = JSON.parse(stderrLine) as Record<string, unknown>
		const ts = parsed.ts as string
		const date = new Date(ts)
		expect(Number.isNaN(date.getTime())).toBe(false)
	})

	test('each log call emits exactly one newline-terminated line', async () => {
		const multiScript = `
import { debugLog } from ${JSON.stringify(path.join(import.meta.dir, 'debug.js'))};
debugLog('first', { n: 1 });
debugLog('second', { n: 2 });
`
		const result = await spawnAndCollect(['bun', '--eval', multiScript], {
			env: { ...process.env, SIDE_QUEST_DEBUG: '1' },
		})
		expect(result.exitCode).toBe(0)
		// Two calls -> two newline-terminated JSON lines
		const lines = result.stderr.trim().split('\n')
		expect(lines).toHaveLength(2)
		const first = JSON.parse(lines[0]!) as Record<string, unknown>
		const second = JSON.parse(lines[1]!) as Record<string, unknown>
		expect(first.event).toBe('first')
		expect(second.event).toBe('second')
	})

	test('produces no stderr output when SIDE_QUEST_DEBUG is unset', async () => {
		const result = await spawnAndCollect(['bun', '--eval', PROBE_SCRIPT], {
			env: {
				...process.env,
				// Explicitly remove the flag so the child starts clean
				SIDE_QUEST_DEBUG: undefined,
			},
		})
		expect(result.exitCode).toBe(0)
		expect(result.stderr.trim()).toBe('')
	})
})
