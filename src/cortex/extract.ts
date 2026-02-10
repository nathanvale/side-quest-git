import { SALIENCE_PATTERNS } from './patterns.js'
import type { CortexEntry } from './types.js'

/**
 * Extract salient entries from transcript JSONL content.
 */
export function extractFromTranscript(transcriptText: string): CortexEntry[] {
	const entries: CortexEntry[] = []
	const now = new Date().toISOString()
	const lines = transcriptText.split('\n').filter((line) => line.trim() !== '')
	const textContent: string[] = []

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line)
			if (
				parsed.type === 'user' &&
				typeof parsed.message?.content === 'string'
			) {
				textContent.push(parsed.message.content)
			}
			if (
				parsed.type === 'assistant' &&
				typeof parsed.message?.content === 'string'
			) {
				textContent.push(parsed.message.content)
			}
			if (
				parsed.type === 'assistant' &&
				Array.isArray(parsed.message?.content)
			) {
				for (const block of parsed.message.content) {
					if (block?.type === 'text' && typeof block.text === 'string') {
						textContent.push(block.text)
					}
				}
			}
		} catch {
			// Ignore malformed JSONL lines.
		}
	}

	const fullText = textContent.join('\n')
	const sentences = fullText
		.split(/[.!?\n]+/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 10)

	for (const sentence of sentences) {
		for (const pattern of SALIENCE_PATTERNS) {
			for (const regex of pattern.patterns) {
				const match = sentence.match(regex)
				if (!match?.[1]) {
					continue
				}

				entries.push({
					timestamp: now,
					type: pattern.type,
					salience: pattern.salience,
					content: match[1].trim().slice(0, 200),
					context: sentence.slice(0, 300),
				})
				break
			}
		}
	}

	const seen = new Set<string>()
	return entries.filter((entry) => {
		const key = `${entry.type}:${entry.content}`
		if (seen.has(key)) {
			return false
		}
		seen.add(key)
		return true
	})
}
