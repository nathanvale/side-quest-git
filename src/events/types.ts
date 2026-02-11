/**
 * Event system type definitions.
 *
 * Why: Defines the canonical event envelope and type unions for the
 * CLI and hook domains, ensuring all event producers share a single
 * schema contract.
 */

/** CLI-domain event types emitted by worktree commands. */
export type CliEventType =
	| 'worktree.created'
	| 'worktree.deleted'
	| 'worktree.synced'
	| 'worktree.cleaned'
	| 'worktree.attached'
	| 'worktree.installed'

/** Hook-domain event types emitted by Claude Code hooks. */
export type HookEventType =
	| 'session.started'
	| 'session.ended'
	| 'session.compacted'
	| 'safety.blocked'
	| 'command.executed'

/** All event types. */
export type EventType = CliEventType | HookEventType

/** Event envelope wrapping all events. */
export interface EventEnvelope<T = unknown> {
	readonly schemaVersion: '1.0.0'
	readonly id: string
	readonly timestamp: string
	readonly type: EventType
	readonly repo: string
	readonly gitRoot: string
	readonly source: 'cli' | 'hook'
	readonly correlationId: string
	readonly data: T
}

/** Context provided when creating events. */
export interface EventContext {
	readonly repo: string
	readonly gitRoot: string
	readonly source: 'cli' | 'hook'
	readonly correlationId?: string
}
