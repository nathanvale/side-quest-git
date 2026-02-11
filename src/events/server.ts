/**
 * HTTP + WebSocket event bus server using Bun.serve().
 *
 * Why: Provides a local event bus that CLI commands and hooks can
 * POST events to, with real-time WebSocket broadcast for dashboards
 * and tail-style consumers. PID/port files enable process discovery.
 *
 * Routes:
 *   POST /events  - Accept JSON event, store, and broadcast
 *   GET  /events  - Query with ?type=, ?since=, ?limit=
 *   GET  /health  - Server health check
 *   WS   /ws      - Real-time event stream (optional ?type= filter)
 */

import { unlinkSync } from 'node:fs'
import path from 'node:path'
import {
	ensureDirSync,
	pathExistsSync,
	readTextFileSync,
	writeTextFileSync,
} from '@side-quest/core/fs'
import type { Server, ServerWebSocket } from 'bun'
import { getEventCacheDir, getRepoCacheKey } from './cache-key.js'
import { createEvent } from './schema.js'
import { EventStore } from './store.js'
import type { EventEnvelope, EventType } from './types.js'

/** Options for starting the event server. */
export interface ServerOptions {
	/** Port to listen on (0 for auto-assign, default: 7483). */
	readonly port?: number
	/** Repository name used for event payload defaults. */
	readonly repoName: string
	/** Stable cache key used for PID/port discovery files. */
	readonly cacheKey?: string
	/** Absolute path to the git root directory. */
	readonly gitRoot: string
	/** Host interface to bind to (default: 127.0.0.1). */
	readonly hostname?: string
	/** Ring buffer capacity (default: 1000). */
	readonly capacity?: number
	/** Path for JSONL persistence file. */
	readonly persistPath?: string
}

/** Running event server handle. */
export interface EventServer {
	/** The port the server is listening on. */
	readonly port: number
	/** Host interface the server is bound to. */
	readonly hostname: string
	/** The underlying event store. */
	readonly store: EventStore
	/** Stop the server and clean up PID/port files. */
	stop(): void
}

/** WebSocket client data for type filtering. */
interface WsClientData {
	readonly typeFilter: string | null
}

/**
 * Check if a PID is still running.
 *
 * Why: Stale PID files from crashed servers need detection
 * so we can clean them up and start a fresh server.
 */
function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/**
 * Write PID and port files for process discovery.
 *
 * Why: Other CLI commands and hooks need to find the running
 * event server's port to POST events or connect via WebSocket.
 */
function writePidFiles(cacheDir: string, port: number, pid: number): void {
	ensureDirSync(cacheDir)
	writeTextFileSync(path.join(cacheDir, 'events.port'), String(port))
	writeTextFileSync(path.join(cacheDir, 'events.pid'), String(pid))
}

/**
 * Remove PID and port files on shutdown.
 *
 * Why: Clean shutdown should remove discovery files so other
 * processes don't try to connect to a dead server.
 */
function removePidFiles(cacheDir: string): void {
	const portFile = path.join(cacheDir, 'events.port')
	const pidFile = path.join(cacheDir, 'events.pid')
	try {
		if (pathExistsSync(portFile)) unlinkSync(portFile)
		if (pathExistsSync(pidFile)) unlinkSync(pidFile)
	} catch {
		// Best-effort cleanup
	}
}

/**
 * Read the event server port from cache files.
 *
 * Why: CLI commands need to discover the running server's port
 * to POST events or connect via WebSocket.
 *
 * @param cacheKey - Stable repo cache key
 * @returns Port number if server is running, null otherwise
 */
export function readEventServerPort(cacheKey: string): number | null {
	const cacheDir = getEventCacheDir(cacheKey)
	const portFile = path.join(cacheDir, 'events.port')
	const pidFile = path.join(cacheDir, 'events.pid')

	if (!pathExistsSync(portFile) || !pathExistsSync(pidFile)) {
		return null
	}

	const pid = Number.parseInt(readTextFileSync(pidFile), 10)
	if (!isProcessRunning(pid)) {
		// Stale PID file - clean up
		removePidFiles(cacheDir)
		return null
	}

	return Number.parseInt(readTextFileSync(portFile), 10)
}

/**
 * Start the event bus server.
 *
 * Why: Central event bus for the side-quest-git ecosystem.
 * CLI commands POST events, hooks POST events, dashboards
 * subscribe via WebSocket for real-time updates.
 *
 * @param options - Server configuration
 * @returns Running server handle with port, store, and stop()
 */
export function startEventServer(options: ServerOptions): EventServer {
	const {
		port = 7483,
		repoName,
		gitRoot,
		cacheKey = getRepoCacheKey(gitRoot),
		hostname = '127.0.0.1',
		capacity,
		persistPath,
	} = options

	const store = new EventStore({ capacity, persistPath })
	const clients = new Set<ServerWebSocket<WsClientData>>()
	const startTime = Date.now()
	const cacheDir = getEventCacheDir(cacheKey)

	// Check for stale PID
	const existingPort = readEventServerPort(cacheKey)
	if (existingPort !== null) {
		// Server already running
		const pidFile = path.join(cacheDir, 'events.pid')
		const pid = Number.parseInt(readTextFileSync(pidFile), 10)
		throw new Error(
			`Event server already running on port ${existingPort} (PID ${pid})`,
		)
	}

	const server: Server<WsClientData> = Bun.serve<WsClientData>({
		hostname,
		port,
		fetch(req, server) {
			const url = new URL(req.url)

			// WebSocket upgrade
			if (url.pathname === '/ws') {
				const typeFilter = url.searchParams.get('type')
				const upgraded = server.upgrade(req, {
					data: { typeFilter },
				})
				if (upgraded) return undefined
				return new Response('WebSocket upgrade failed', { status: 400 })
			}

			// POST /events - accept and broadcast
			if (req.method === 'POST' && url.pathname === '/events') {
				return handlePostEvent(req, store, clients, gitRoot, repoName)
			}

			// GET /events - query
			if (req.method === 'GET' && url.pathname === '/events') {
				return handleGetEvents(url, store)
			}

			// GET /health
			if (req.method === 'GET' && url.pathname === '/health') {
				return Response.json({
					status: 'ok',
					uptime: Math.floor((Date.now() - startTime) / 1000),
					events: store.size,
				})
			}

			return new Response('Not Found', { status: 404 })
		},
		websocket: {
			open(ws) {
				clients.add(ws)
			},
			close(ws) {
				clients.delete(ws)
			},
			message() {
				// Clients don't send messages; this is a broadcast-only channel
			},
		},
	})

	const actualPort = server.port ?? port
	writePidFiles(cacheDir, actualPort, process.pid)

	return {
		port: actualPort as number,
		hostname,
		store,
		stop() {
			// Close all WebSocket connections
			for (const ws of clients) {
				ws.close(1000, 'server shutting down')
			}
			clients.clear()
			server.stop(true)
			removePidFiles(cacheDir)
		},
	}
}

/**
 * Handle POST /events requests.
 *
 * Accepts either a full EventEnvelope or a partial payload with
 * { type, data } fields, auto-wrapping in an envelope if needed.
 */
async function handlePostEvent(
	req: Request,
	store: EventStore,
	clients: Set<ServerWebSocket<WsClientData>>,
	gitRoot: string,
	repoName: string,
): Promise<Response> {
	try {
		const body = (await req.json()) as Record<string, unknown>

		// If the body has schemaVersion, treat it as a full envelope
		let event: EventEnvelope
		if (body.schemaVersion) {
			event = body as unknown as EventEnvelope
		} else {
			// Wrap in envelope using createEvent
			event = createEvent(
				body.type as EventType,
				(body.data as Record<string, unknown>) ?? {},
				{
					repo: (body.repo as string) ?? repoName,
					gitRoot: (body.gitRoot as string) ?? gitRoot,
					source: (body.source as 'cli' | 'hook') ?? 'cli',
					correlationId: body.correlationId as string | undefined,
				},
			)
		}

		store.push(event)

		// Broadcast to WebSocket clients
		const message = JSON.stringify(event)
		for (const ws of clients) {
			if (ws.data.typeFilter && ws.data.typeFilter !== event.type) {
				continue
			}
			ws.send(message)
		}

		return Response.json({ ok: true, id: event.id }, { status: 201 })
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Unknown error'
		return Response.json({ error: msg }, { status: 400 })
	}
}

/**
 * Handle GET /events query requests.
 *
 * Supports ?type=, ?since=, ?limit= query parameters.
 */
function handleGetEvents(url: URL, store: EventStore): Response {
	const type = url.searchParams.get('type') as EventType | null
	const since = url.searchParams.get('since')
	const limitStr = url.searchParams.get('limit')
	const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined

	const events = store.query({
		type: type ?? undefined,
		since: since ?? undefined,
		limit,
	})

	return Response.json(events)
}
