import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getRepoCacheKey } from './cache-key.js'
import { createEvent } from './schema.js'
import { type EventServer, readEventServerPort, startEventServer } from './server.js'
import { EventStore } from './store.js'
import type { EventEnvelope } from './types.js'

/** Reusable test context. */
const testRepo = `test-repo-${Date.now()}`
const testGitRoot = '/tmp/test-repo'

/** Helper to create a test event envelope. */
function makeEvent(
	type: 'worktree.created' | 'worktree.deleted' | 'session.started' = 'worktree.created',
	data: Record<string, unknown> = {},
): EventEnvelope {
	return createEvent(type, data, {
		repo: testRepo,
		gitRoot: testGitRoot,
		source: 'cli',
	})
}

// =============================================
// EventStore unit tests
// =============================================

describe('EventStore', () => {
	test('push and query returns events', () => {
		const store = new EventStore({ capacity: 10 })
		const event = makeEvent('worktree.created', { branch: 'feat/a' })
		store.push(event)

		const result = store.query()
		expect(result).toHaveLength(1)
		expect(result[0]?.type).toBe('worktree.created')
	})

	test('query filters by type', () => {
		const store = new EventStore({ capacity: 10 })
		store.push(makeEvent('worktree.created'))
		store.push(makeEvent('worktree.deleted'))
		store.push(makeEvent('worktree.created'))

		const result = store.query({ type: 'worktree.created' })
		expect(result).toHaveLength(2)
	})

	test('query filters by since timestamp', () => {
		const store = new EventStore({ capacity: 10 })

		const oldEvent = makeEvent('worktree.created')
		store.push(oldEvent)

		// Create a timestamp between old and new events
		const since = new Date().toISOString()

		// Small delay to ensure timestamp difference
		const newEvent = createEvent(
			'worktree.deleted',
			{},
			{ repo: testRepo, gitRoot: testGitRoot, source: 'cli' },
		)
		// Manually set a future timestamp for the new event
		const futureEvent = {
			...newEvent,
			timestamp: new Date(Date.now() + 1000).toISOString(),
		} as EventEnvelope
		store.push(futureEvent)

		const result = store.query({ since })
		expect(result).toHaveLength(1)
		expect(result[0]?.type).toBe('worktree.deleted')
	})

	test('query respects limit', () => {
		const store = new EventStore({ capacity: 10 })
		for (let i = 0; i < 5; i++) {
			store.push(makeEvent('worktree.created', { index: i }))
		}

		const result = store.query({ limit: 2 })
		expect(result).toHaveLength(2)
		// Should return the last 2 events
		expect((result[0]?.data as Record<string, unknown>).index).toBe(3)
		expect((result[1]?.data as Record<string, unknown>).index).toBe(4)
	})

	test('ring buffer evicts oldest when full', () => {
		const store = new EventStore({ capacity: 3 })

		store.push(makeEvent('worktree.created', { index: 0 }))
		store.push(makeEvent('worktree.created', { index: 1 }))
		store.push(makeEvent('worktree.created', { index: 2 }))
		// This should evict index 0
		store.push(makeEvent('worktree.created', { index: 3 }))

		expect(store.size).toBe(3)

		const events = store.query()
		expect(events).toHaveLength(3)
		// Oldest surviving event should be index 1
		expect((events[0]?.data as Record<string, unknown>).index).toBe(1)
		expect((events[1]?.data as Record<string, unknown>).index).toBe(2)
		expect((events[2]?.data as Record<string, unknown>).index).toBe(3)
	})

	test('last(n) returns correct number of events', () => {
		const store = new EventStore({ capacity: 10 })
		for (let i = 0; i < 5; i++) {
			store.push(makeEvent('worktree.created', { index: i }))
		}

		const result = store.last(2)
		expect(result).toHaveLength(2)
		expect((result[0]?.data as Record<string, unknown>).index).toBe(3)
		expect((result[1]?.data as Record<string, unknown>).index).toBe(4)
	})

	test('size tracks count correctly', () => {
		const store = new EventStore({ capacity: 5 })
		expect(store.size).toBe(0)

		store.push(makeEvent())
		expect(store.size).toBe(1)

		store.push(makeEvent())
		expect(store.size).toBe(2)
	})

	test('size does not exceed capacity', () => {
		const store = new EventStore({ capacity: 3 })
		for (let i = 0; i < 10; i++) {
			store.push(makeEvent())
		}
		expect(store.size).toBe(3)
	})
})

// =============================================
// HTTP server integration tests
// =============================================

describe('Event Server HTTP', () => {
	let server: EventServer
	let serverGitRoot: string

	beforeEach(() => {
		// Use port 0 for auto-assign to avoid conflicts
		serverGitRoot = `/tmp/test-http-${Date.now()}-${Math.random().toString(36).slice(2)}`
		server = startEventServer({
			port: 0,
			repoName: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			gitRoot: serverGitRoot,
			capacity: 100,
		})
	})

	afterEach(() => {
		server.stop()
	})

	test('binds to localhost by default', () => {
		expect(server.hostname).toBe('127.0.0.1')
	})

	test('writes discovery files using gitRoot-derived cache key', () => {
		const cacheKey = getRepoCacheKey(serverGitRoot)
		const discoveredPort = readEventServerPort(cacheKey)
		expect(discoveredPort).toBe(server.port)
	})

	test('POST /events stores event and returns 201', async () => {
		const event = makeEvent('worktree.created', { branch: 'feat/test' })

		const res = await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
		})

		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.ok).toBe(true)
		expect(body.id).toBe(event.id)
		expect(server.store.size).toBe(1)
	})

	test('POST /events accepts partial payload and wraps in envelope', async () => {
		const res = await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'worktree.created',
				data: { branch: 'feat/auto' },
			}),
		})

		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.ok).toBe(true)
		expect(typeof body.id).toBe('string')
	})

	test('POST /events returns 400 for invalid JSON', async () => {
		const res = await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not json',
		})

		expect(res.status).toBe(400)
	})

	test('GET /events returns stored events', async () => {
		const event = makeEvent('worktree.created', { branch: 'feat/get' })
		server.store.push(event)

		const res = await fetch(`http://localhost:${server.port}/events`)
		expect(res.status).toBe(200)

		const events = await res.json()
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('worktree.created')
	})

	test('GET /events?type= filters by event type', async () => {
		server.store.push(makeEvent('worktree.created'))
		server.store.push(makeEvent('worktree.deleted'))
		server.store.push(makeEvent('worktree.created'))

		const res = await fetch(`http://localhost:${server.port}/events?type=worktree.deleted`)
		const events = await res.json()
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('worktree.deleted')
	})

	test('GET /events?since= returns events after timestamp', async () => {
		const oldEvent = makeEvent('worktree.created')
		server.store.push(oldEvent)

		const since = new Date().toISOString()

		const newEvent = {
			...makeEvent('worktree.deleted'),
			timestamp: new Date(Date.now() + 1000).toISOString(),
		} as EventEnvelope
		server.store.push(newEvent)

		const res = await fetch(
			`http://localhost:${server.port}/events?since=${encodeURIComponent(since)}`,
		)
		const events = await res.json()
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('worktree.deleted')
	})

	test('GET /events?limit= limits result count', async () => {
		for (let i = 0; i < 5; i++) {
			server.store.push(makeEvent('worktree.created', { index: i }))
		}

		const res = await fetch(`http://localhost:${server.port}/events?limit=2`)
		const events = await res.json()
		expect(events).toHaveLength(2)
	})

	test('GET /health returns uptime and event count', async () => {
		server.store.push(makeEvent())
		server.store.push(makeEvent())

		const res = await fetch(`http://localhost:${server.port}/health`)
		expect(res.status).toBe(200)

		const health = await res.json()
		expect(health.status).toBe('ok')
		expect(typeof health.uptime).toBe('number')
		expect(health.uptime).toBeGreaterThanOrEqual(0)
		expect(health.events).toBe(2)
	})

	test('returns 404 for unknown routes', async () => {
		const res = await fetch(`http://localhost:${server.port}/unknown`)
		expect(res.status).toBe(404)
	})
})

// =============================================
// WebSocket integration tests
// =============================================

describe('Event Server WebSocket', () => {
	let server: EventServer

	beforeEach(() => {
		const serverGitRoot = `/tmp/test-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`
		server = startEventServer({
			port: 0,
			repoName: `test-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			gitRoot: serverGitRoot,
			capacity: 100,
		})
	})

	afterEach(() => {
		server.stop()
	})

	test('WebSocket client receives broadcast on POST', async () => {
		const received: EventEnvelope[] = []

		const ws = new WebSocket(`ws://localhost:${server.port}/ws`)

		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve()
			ws.onerror = (_e) => reject(new Error('WS connection failed'))
			setTimeout(() => reject(new Error('WS open timeout')), 5000)
		})

		ws.onmessage = (event) => {
			received.push(JSON.parse(event.data as string))
		}

		// POST an event
		const testEvent = makeEvent('worktree.created', { branch: 'feat/ws' })
		await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(testEvent),
		})

		// Wait for broadcast
		await new Promise((resolve) => setTimeout(resolve, 100))

		expect(received).toHaveLength(1)
		expect(received[0]?.type).toBe('worktree.created')
		expect((received[0]?.data as Record<string, unknown>).branch).toBe('feat/ws')

		ws.close()
	})

	test('WebSocket type filter only receives matching events', async () => {
		const received: EventEnvelope[] = []

		// Connect with type filter
		const ws = new WebSocket(`ws://localhost:${server.port}/ws?type=worktree.deleted`)

		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve()
			ws.onerror = () => reject(new Error('WS connection failed'))
			setTimeout(() => reject(new Error('WS open timeout')), 5000)
		})

		ws.onmessage = (event) => {
			received.push(JSON.parse(event.data as string))
		}

		// POST events of different types
		await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(makeEvent('worktree.created')),
		})
		await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(makeEvent('worktree.deleted')),
		})
		await fetch(`http://localhost:${server.port}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(makeEvent('worktree.created')),
		})

		// Wait for broadcasts
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Should only receive the worktree.deleted event
		expect(received).toHaveLength(1)
		expect(received[0]?.type).toBe('worktree.deleted')

		ws.close()
	})
})
