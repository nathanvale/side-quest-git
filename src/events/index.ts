/**
 * Event system for @side-quest/git.
 *
 * Provides the canonical event envelope type, domain-specific event
 * type unions, a factory function for creating events, an in-memory
 * ring buffer store, an HTTP/WebSocket event bus server, and a
 * WebSocket client for real-time consumption.
 *
 * @example
 * ```ts
 * import { createEvent, type EventEnvelope } from '@side-quest/git/events'
 *
 * const event = createEvent('worktree.created', { branch: 'feat/foo' }, {
 *   repo: 'my-repo',
 *   gitRoot: '/home/user/my-repo',
 *   source: 'cli',
 * })
 * ```
 */

export * from './client.js'
export * from './emit.js'
export * from './schema.js'
export * from './server.js'
export * from './store.js'
export * from './types.js'
