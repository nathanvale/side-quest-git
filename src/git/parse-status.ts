import type { ParsedGitStatus } from './types.js'

/**
 * Parse `git status --porcelain -b` output into branch + change counters.
 */
export function parseGitStatus(statusOut: string): ParsedGitStatus {
	const lines = statusOut.split('\n')
	const branchLine = lines.find((line) => line.startsWith('##'))

	let branch = '(detached)'
	if (branchLine) {
		const parsed = branchLine.slice(3).split('...')[0]
		if (parsed) {
			branch = parsed.trim()
		}
	}

	let staged = 0
	let modified = 0
	let untracked = 0

	for (const line of lines) {
		if (!line.trim() || line.startsWith('##')) {
			continue
		}

		const code = line.slice(0, 2)
		if (code.startsWith('?') || code === '??') {
			untracked++
			continue
		}

		if (code[0] !== ' ' && code[0] !== '?') {
			staged++
		}
		if (code[1] !== ' ' && code[1] !== '?') {
			modified++
		}
	}

	return {
		branch,
		status: { staged, modified, untracked },
	}
}
