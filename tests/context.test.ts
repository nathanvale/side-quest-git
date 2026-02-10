import { describe, expect, test } from 'bun:test'
import { getGitContext, parseGitStatus } from '../src/index.js'

describe('parseGitStatus', () => {
	test('parses clean status', () => {
		const result = parseGitStatus('## main...origin/main')
		expect(result.branch).toBe('main')
		expect(result.status).toEqual({ staged: 0, modified: 0, untracked: 0 })
	})

	test('parses dirty status', () => {
		const output = `## feature/test...origin/feature/test [ahead 1]\nM  modified.ts\nA  staged.ts\n?? untracked.ts\n D deleted.ts`
		const result = parseGitStatus(output)
		expect(result.branch).toBe('feature/test')
		expect(result.status).toEqual({ staged: 2, modified: 1, untracked: 1 })
	})
})

describe('getGitContext', () => {
	test('returns null outside git repo', async () => {
		expect(await getGitContext('/tmp')).toBeNull()
	})

	test('returns context for current repo', async () => {
		const context = await getGitContext(process.cwd())
		expect(context).not.toBeNull()
		expect(typeof context?.branch).toBe('string')
		expect(Array.isArray(context?.recentCommits)).toBe(true)
	})
})
