/**
 * Fire-and-forget event emission to the local event bus.
 *
 * Why: CLI commands need to emit events without blocking or failing.
 * The emitter has a fast path when no server is running (<5ms)
 * and a 500ms timeout when the server exists but is slow.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEvent } from './schema.js'
import type { EventContext, EventEnvelope, EventType } from './types.js'

/**
 * Check if the event server is running for a given repo.
 *
 * Why: Fast path -- if no PID file exists, skip HTTP entirely.
 * Checking a file takes <1ms vs. HTTP connection setup.
 *
 * @param repoName - Repository directory name used for cache lookups
 * @returns The port number if the server is running, null otherwise
 */
export function isEventServerRunning(repoName: string): number | null {
	const cacheDir = path.join(os.homedir(), '.cache', 'side-quest-git', repoName)
	const pidPath = path.join(cacheDir, 'events.pid')
	const portPath = path.join(cacheDir, 'events.port')

	try {
		const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10)
		const port = Number.parseInt(fs.readFileSync(portPath, 'utf-8').trim(), 10)
		// Check if process is alive
		process.kill(pid, 0)
		return port
	} catch {
		return null
	}
}

/**
 * Emit an event to the local event bus (fire-and-forget).
 *
 * Why: Every CLI command should emit an event for observability,
 * but emission must never block or fail the command itself.
 * Uses 500ms AbortController timeout and catches all errors.
 *
 * @param event - The event envelope to send
 * @param port - The port the event server is listening on
 */
export async function emitEvent(
	event: EventEnvelope,
	port: number,
): Promise<void> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), 500)

	try {
		await fetch(`http://127.0.0.1:${port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
			signal: controller.signal,
		})
	} catch {
		// Silent fail -- emission is best-effort
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Convenience: create and emit an event in one call.
 *
 * Why: Reduces boilerplate in CLI commands. Handles the full
 * "is server running? create envelope, POST it" flow.
 *
 * @param type - The event type discriminator
 * @param data - Event-specific payload
 * @param context - Shared context (repo, gitRoot, source, optional correlationId)
 */
export async function emitCliEvent<T>(
	type: EventType,
	data: T,
	context: EventContext,
): Promise<void> {
	const repoName = path.basename(context.gitRoot)
	const port = isEventServerRunning(repoName)
	if (port === null) return // Fast path: no server

	const event = createEvent(type, data, context)
	await emitEvent(event, port)
}
