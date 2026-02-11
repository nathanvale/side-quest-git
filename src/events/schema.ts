/**
 * Event factory for creating type-safe event envelopes.
 *
 * Why: Centralizes envelope creation so all events have consistent
 * structure, unique IDs via nanoId, and UTC timestamps. Correlation
 * IDs use generateCorrelationId for W3C-compatible 8-char hex format.
 */

import { generateCorrelationId } from '@side-quest/core/instrumentation'
import { nanoId } from '@side-quest/core/utils'
import type { EventContext, EventEnvelope, EventType } from './types.js'

/**
 * Create an event envelope with auto-generated id and timestamp.
 *
 * Why: Centralizes envelope creation so all events have consistent
 * structure, unique IDs, and UTC timestamps.
 *
 * @param type - The event type discriminator
 * @param data - Event-specific payload
 * @param context - Shared context (repo, gitRoot, source, optional correlationId)
 * @returns Fully-formed event envelope ready for serialization
 *
 * @example
 * ```ts
 * const event = createEvent('worktree.created', { branch: 'feat/foo' }, {
 *   repo: 'my-repo',
 *   gitRoot: '/home/user/my-repo',
 *   source: 'cli',
 * })
 * ```
 */
export function createEvent<T>(
	type: EventType,
	data: T,
	context: EventContext,
): EventEnvelope<T> {
	return {
		schemaVersion: '1.0.0',
		id: nanoId(),
		timestamp: new Date().toISOString(),
		type,
		repo: context.repo,
		gitRoot: context.gitRoot,
		source: context.source,
		correlationId: context.correlationId ?? generateCorrelationId(),
		data,
	}
}
