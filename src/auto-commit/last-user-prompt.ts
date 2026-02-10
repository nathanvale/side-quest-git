import { readFile } from 'node:fs/promises'

/**
 * Extract the last user prompt from a transcript JSONL file.
 */
export async function getLastUserPrompt(
	transcriptPath: string,
): Promise<string | null> {
	try {
		const content = await readFile(transcriptPath, 'utf-8')
		const lines = content.split('\n').filter((line) => line.trim() !== '')
		let lastUserPrompt: string | null = null

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line)
				if (
					parsed.type === 'user' &&
					typeof parsed.message?.content === 'string'
				) {
					lastUserPrompt = parsed.message.content
				}
			} catch {
				// Ignore malformed lines.
			}
		}

		return lastUserPrompt
	} catch {
		return null
	}
}
