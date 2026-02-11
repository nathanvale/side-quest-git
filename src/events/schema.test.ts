import { describe, expect, test } from 'bun:test'
import { createEvent } from './schema.js'
import type { EventContext } from './types.js'

/** Reusable test context for event creation. */
const testContext: EventContext = {
	repo: 'test-repo',
	gitRoot: '/home/user/test-repo',
	source: 'cli',
}

describe('createEvent', () => {
	test('returns envelope with valid id (string, non-empty)', () => {
		const event = createEvent('worktree.created', { branch: 'main' }, testContext)
		expect(typeof event.id).toBe('string')
		expect(event.id.length).toBeGreaterThan(0)
	})

	test('returns ISO 8601 timestamp', () => {
		const event = createEvent('worktree.created', {}, testContext)
		// ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
		const parsed = Date.parse(event.timestamp)
		expect(Number.isNaN(parsed)).toBe(false)
		expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	})

	test('has schemaVersion 1.0.0', () => {
		const event = createEvent('session.started', {}, testContext)
		expect(event.schemaVersion).toBe('1.0.0')
	})

	test('auto-generates correlationId when not provided', () => {
		const event = createEvent('worktree.deleted', {}, testContext)
		expect(typeof event.correlationId).toBe('string')
		expect(event.correlationId.length).toBeGreaterThan(0)
	})

	test('passes through correlationId when provided', () => {
		const contextWithCid: EventContext = {
			...testContext,
			correlationId: 'abc12345',
		}
		const event = createEvent('worktree.synced', {}, contextWithCid)
		expect(event.correlationId).toBe('abc12345')
	})

	test('preserves type, repo, gitRoot, source, data fields', () => {
		const data = { branch: 'feat/foo', path: '/tmp/worktree' }
		const event = createEvent('worktree.created', data, {
			repo: 'my-repo',
			gitRoot: '/home/user/my-repo',
			source: 'hook',
		})

		expect(event.type).toBe('worktree.created')
		expect(event.repo).toBe('my-repo')
		expect(event.gitRoot).toBe('/home/user/my-repo')
		expect(event.source).toBe('hook')
		expect(event.data).toEqual(data)
	})
})
