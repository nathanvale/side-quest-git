import type { SaliencePattern } from './types.js'

/** Salience extraction rules for transcript mining. */
export const SALIENCE_PATTERNS: readonly SaliencePattern[] = [
	{
		type: 'decision',
		salience: 0.9,
		patterns: [
			/decided to\s+(.+)/i,
			/going with\s+(.+)/i,
			/the approach is\s+(.+)/i,
			/we(?:'ll| will) use\s+(.+)/i,
			/let(?:'s| us) go with\s+(.+)/i,
		],
	},
	{
		type: 'error_fix',
		salience: 0.8,
		patterns: [
			/(?:fixed|resolved|solved)\s+(?:by|with|the)\s+(.+)/i,
			/the (?:fix|solution) (?:was|is)\s+(.+)/i,
			/error was caused by\s+(.+)/i,
			/root cause(?::| was)\s+(.+)/i,
		],
	},
	{
		type: 'learning',
		salience: 0.7,
		patterns: [
			/(?:TIL|learned that)\s+(.+)/i,
			/turns out\s+(.+)/i,
			/the issue was\s+(.+)/i,
			/(?:discovered|found out)\s+(?:that\s+)?(.+)/i,
		],
	},
	{
		type: 'preference',
		salience: 0.7,
		patterns: [
			/always\s+(.+)/i,
			/never\s+(.+)/i,
			/prefer\s+(.+)/i,
			/(?:I|we) want\s+(.+)/i,
		],
	},
]
