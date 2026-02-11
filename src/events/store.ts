/**
 * In-memory ring buffer with optional JSONL persistence.
 *
 * Why: Events need fast in-memory access for queries and WebSocket
 * broadcast, plus durable persistence for post-mortem analysis.
 * A ring buffer gives O(1) insertion and bounded memory usage,
 * while JSONL append gives crash-safe durability without write amplification.
 */

import path from 'node:path'
import { appendToFileSync, ensureDirSync } from '@side-quest/core/fs'
import type { EventEnvelope, EventType } from './types.js'

/** Configuration for the event store. */
export interface StoreOptions {
	/** Maximum number of events to retain in memory (default: 1000). */
	readonly capacity?: number
	/** Optional path to a JSONL file for durable persistence. */
	readonly persistPath?: string
}

/** Filter criteria for querying stored events. */
export interface EventFilter {
	/** Only return events of this type. */
	readonly type?: EventType
	/** Only return events with timestamp strictly after this ISO string. */
	readonly since?: string
	/** Maximum number of events to return (from the tail). */
	readonly limit?: number
}

/**
 * Ring buffer event store with optional JSONL append persistence.
 *
 * Why: Provides bounded in-memory storage for real-time queries
 * while optionally appending each event to a JSONL file for
 * durable post-mortem analysis.
 */
export class EventStore {
	private readonly buffer: EventEnvelope[]
	private readonly capacity: number
	private readonly persistPath: string | null
	private writeIndex = 0
	private count = 0

	constructor(options: StoreOptions = {}) {
		this.capacity = options.capacity ?? 1000
		this.buffer = new Array(this.capacity)
		this.persistPath = options.persistPath ?? null
		if (this.persistPath) {
			ensureDirSync(path.dirname(this.persistPath))
		}
	}

	/** Push an event into the ring buffer and optionally persist to JSONL. */
	push(event: EventEnvelope): void {
		this.buffer[this.writeIndex] = event
		this.writeIndex = (this.writeIndex + 1) % this.capacity
		if (this.count < this.capacity) this.count++
		if (this.persistPath) {
			appendToFileSync(this.persistPath, `${JSON.stringify(event)}\n`)
		}
	}

	/** Query events by optional type, timestamp, and limit filters. */
	query(filter?: EventFilter): EventEnvelope[] {
		let events = this.toArray()
		if (filter?.type) {
			events = events.filter((e) => e.type === filter.type)
		}
		if (filter?.since) {
			const since = filter.since
			events = events.filter((e) => e.timestamp > since)
		}
		if (filter?.limit) {
			events = events.slice(-filter.limit)
		}
		return events
	}

	/** Get last N events from the buffer. */
	last(n: number): EventEnvelope[] {
		return this.toArray().slice(-n)
	}

	/** Total events currently stored in the ring buffer. */
	get size(): number {
		return this.count
	}

	/**
	 * Materialize the ring buffer into a chronologically ordered array.
	 *
	 * Why: When the buffer wraps, the oldest event starts at writeIndex.
	 * We need to stitch the two halves together for correct ordering.
	 */
	private toArray(): EventEnvelope[] {
		if (this.count < this.capacity) {
			return this.buffer.slice(0, this.count)
		}
		// Ring buffer is full: oldest is at writeIndex, newest is at writeIndex - 1
		return [
			...this.buffer.slice(this.writeIndex),
			...this.buffer.slice(0, this.writeIndex),
		]
	}
}
