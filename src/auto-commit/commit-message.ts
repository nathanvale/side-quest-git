import { truncateForSubject } from './truncate.js'

/**
 * Build a WIP commit message from an optional user prompt.
 */
export function generateCommitMessage(prompt: string | null): string {
	const subjectMaxLen = 50
	const effectivePrompt =
		typeof prompt === 'string' && prompt.trim() !== ''
			? prompt
			: 'session checkpoint'
	const truncatedPrompt = truncateForSubject(effectivePrompt, subjectMaxLen)

	return `chore(wip): ${truncatedPrompt}\n\nSession work in progress - run /git:commit to squash.`
}
