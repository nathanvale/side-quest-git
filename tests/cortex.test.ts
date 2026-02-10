import { describe, expect, test } from 'bun:test'
import { extractFromTranscript } from '../src/index.js'

function makeTranscript(messages: { type: string; content: string }[]): string {
	return messages
		.map((message) =>
			JSON.stringify({
				type: message.type,
				message: { role: message.type, content: message.content },
			}),
		)
		.join('\n')
}

describe('extractFromTranscript', () => {
	test('extracts decisions', () => {
		const transcript = makeTranscript([
			{ type: 'assistant', content: 'We decided to use JWT tokens.' },
		])
		const entries = extractFromTranscript(transcript)
		expect(entries.find((entry) => entry.type === 'decision')).toBeDefined()
	})

	test('extracts error fixes, learnings, preferences', () => {
		const transcript = makeTranscript([
			{ type: 'assistant', content: 'The error was caused by a bad import.' },
			{ type: 'assistant', content: 'Turns out the API needs Bearer auth.' },
			{ type: 'user', content: 'I always want tests first.' },
		])

		const entries = extractFromTranscript(transcript)
		expect(entries.find((entry) => entry.type === 'error_fix')).toBeDefined()
		expect(entries.find((entry) => entry.type === 'learning')).toBeDefined()
		expect(entries.find((entry) => entry.type === 'preference')).toBeDefined()
	})

	test('deduplicates entries', () => {
		const transcript = makeTranscript([
			{ type: 'assistant', content: 'We decided to use React.' },
			{ type: 'assistant', content: 'We decided to use React.' },
		])
		const entries = extractFromTranscript(transcript)
		expect(entries.filter((entry) => entry.type === 'decision')).toHaveLength(1)
	})

	test('ignores malformed lines', () => {
		const transcript = `invalid json\n${JSON.stringify({
			type: 'assistant',
			message: { role: 'assistant', content: 'Turns out the parser was wrong.' },
		})}`
		const entries = extractFromTranscript(transcript)
		expect(entries.length).toBeGreaterThan(0)
	})
})
