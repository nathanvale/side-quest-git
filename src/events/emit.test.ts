/**
 * Tests for fire-and-forget event emission.
 *
 * Why: Validates the fast-path (no server) behavior, real HTTP
 * emission against a live event server, silent failure on
 * connection refused, and 500ms timeout enforcement.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import type { Server } from 'bun'
import { getEventCacheDir, getRepoCacheKey } from './cache-key.js'
import { emitCliEvent, emitEvent, isEventServerRunning } from './emit.js'
import { createEvent } from './schema.js'
import type { EventServer } from './server.js'

describe('isEventServerRunning', () => {
	test('returns null when no PID file exists', () => {
		// Use a cache key that definitely has no cache files
		const result = isEventServerRunning(getRepoCacheKey('/tmp/nonexistent-repo-xyz-12345'))
		expect(result).toBeNull()
	})

	test('returns port when PID and port files exist for a live process', () => {
		const cacheKey = getRepoCacheKey(`/tmp/test-repo-${Date.now()}`)
		const cacheDir = getEventCacheDir(cacheKey)
		fs.mkdirSync(cacheDir, { recursive: true })

		try {
			// Write our own PID (which is alive) and a fake port
			fs.writeFileSync(path.join(cacheDir, 'events.pid'), String(process.pid))
			fs.writeFileSync(path.join(cacheDir, 'events.port'), '9999')

			const result = isEventServerRunning(cacheKey)
			expect(result).toBe(9999)
		} finally {
			// Cleanup
			fs.rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test('returns null when PID file references a dead process', () => {
		const cacheKey = getRepoCacheKey(`/tmp/test-repo-dead-${Date.now()}`)
		const cacheDir = getEventCacheDir(cacheKey)
		fs.mkdirSync(cacheDir, { recursive: true })

		try {
			// Use a PID that almost certainly does not exist
			fs.writeFileSync(path.join(cacheDir, 'events.pid'), '999999')
			fs.writeFileSync(path.join(cacheDir, 'events.port'), '9999')

			const result = isEventServerRunning(cacheKey)
			expect(result).toBeNull()
		} finally {
			fs.rmSync(cacheDir, { recursive: true, force: true })
		}
	})
})

describe('emitEvent', () => {
	let server: EventServer

	beforeEach(async () => {
		// Dynamically import to avoid circular issues
		const { startEventServer } = await import('./server.js')
		const repoName = `emit-test-${Date.now()}`
		server = startEventServer({
			port: 0,
			repoName,
			gitRoot: `/tmp/${repoName}`,
		})
	})

	afterEach(() => {
		server.stop()
	})

	test('sends POST to server and event is stored', async () => {
		const event = createEvent(
			'worktree.created',
			{ branch: 'feat/test' },
			{
				repo: 'test-repo',
				gitRoot: '/tmp/fake-git-root',
				source: 'cli',
			},
		)

		await emitEvent(event, server.port)

		// Give the server a moment to process
		await Bun.sleep(50)

		const stored = server.store.query({ type: 'worktree.created' })
		expect(stored.length).toBe(1)
		expect(stored[0]?.id).toBe(event.id)
		expect((stored[0]?.data as Record<string, unknown>).branch).toBe('feat/test')
	})

	test('returns silently when server is not running (connection refused)', async () => {
		const event = createEvent(
			'worktree.deleted',
			{ branch: 'feat/gone' },
			{
				repo: 'test-repo',
				gitRoot: '/tmp/fake-git-root',
				source: 'cli',
			},
		)

		// Port 1 is almost certainly not running an HTTP server
		await expect(emitEvent(event, 1)).resolves.toBeUndefined()
	})

	test('respects 500ms timeout on a slow server', async () => {
		let slowServer: Server | null = null

		try {
			// Create a server that delays its response beyond 500ms
			slowServer = Bun.serve({
				port: 0,
				async fetch() {
					await Bun.sleep(2000)
					return new Response('too late')
				},
			})

			const event = createEvent(
				'worktree.synced',
				{ branch: 'feat/slow' },
				{
					repo: 'test-repo',
					gitRoot: '/tmp/fake-git-root',
					source: 'cli',
				},
			)

			const start = Date.now()
			await emitEvent(event, slowServer.port)
			const elapsed = Date.now() - start

			// Should abort well before the 2s server delay
			// Allow generous margin but must be under 1500ms
			expect(elapsed).toBeLessThan(1500)
		} finally {
			slowServer?.stop(true)
		}
	})
})

describe('emitCliEvent', () => {
	test('skips emission when no server is running (fast path)', async () => {
		const start = Date.now()

		await emitCliEvent(
			'worktree.created',
			{ branch: 'feat/quick' },
			{
				repo: 'nonexistent-repo-xyz',
				gitRoot: '/tmp/nonexistent-repo-xyz',
				source: 'cli',
			},
		)

		const elapsed = Date.now() - start
		// Fast path should complete in under 5ms (file existence check only)
		expect(elapsed).toBeLessThan(50)
	})

	test('emits event when server is running', async () => {
		const repoName = `emit-cli-test-${Date.now()}`
		const gitRoot = `/tmp/${repoName}`

		const { startEventServer } = await import('./server.js')
		const server = startEventServer({
			port: 0,
			repoName,
			gitRoot,
		})

		try {
			await emitCliEvent(
				'worktree.created',
				{ branch: 'feat/wired' },
				{
					repo: repoName,
					gitRoot,
					source: 'cli',
				},
			)

			// Give the server a moment to process
			await Bun.sleep(50)

			const stored = server.store.query({ type: 'worktree.created' })
			expect(stored.length).toBe(1)
			expect((stored[0]?.data as Record<string, unknown>).branch).toBe('feat/wired')
		} finally {
			server.stop()
		}
	})

	test('does not collide across repos with the same basename', async () => {
		const rootA = `/tmp/a-${Date.now()}/app`
		const rootB = `/tmp/b-${Date.now()}/app`
		const { startEventServer } = await import('./server.js')
		const server = startEventServer({
			port: 0,
			repoName: 'app',
			gitRoot: rootA,
		})

		try {
			await emitCliEvent(
				'worktree.created',
				{ branch: 'feat/no-collision' },
				{
					repo: 'app',
					gitRoot: rootB,
					source: 'cli',
				},
			)

			await Bun.sleep(50)
			const stored = server.store.query({ type: 'worktree.created' })
			expect(stored).toHaveLength(0)
		} finally {
			server.stop()
		}
	})
})
