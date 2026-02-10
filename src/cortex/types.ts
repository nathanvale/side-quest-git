/** A single salient memory extracted from a transcript. */
export interface CortexEntry {
	timestamp: string
	type: 'decision' | 'error_fix' | 'learning' | 'preference'
	salience: number
	content: string
	context?: string
}

/** Salience pattern configuration. */
export interface SaliencePattern {
	type: CortexEntry['type']
	salience: number
	patterns: readonly RegExp[]
}
