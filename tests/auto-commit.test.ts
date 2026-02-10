import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	createAutoCommit,
	generateCommitMessage,
	getGitStatus,
	getLastUserPrompt,
	parseGitStatusCounts,
	printUserNotification,
	truncateForSubject,
} from '../src/index.js'

describe('parseGitStatus', () => {
	test('parses clean status', () => {
		expect(parseGitStatusCounts('')).toEqual({ staged: 0, modified: 0, untracked: 0 })
	})

	test('parses mixed status', () => {
		const output = `M  src/staged.ts\n M src/modified.ts\nMM src/both.ts\n?? src/untracked.ts`
		expect(parseGitStatusCounts(output)).toEqual({
			staged: 2,
			modified: 2,
			untracked: 1,
		})
	})
})

describe('getLastUserPrompt', () => {
	let tempDir: string
	let transcriptPath: string

	beforeEach(async () => {
		tempDir = join(tmpdir(), `git-hook-test-${Date.now()}`)
		await mkdir(tempDir, { recursive: true })
		transcriptPath = join(tempDir, 'transcript.jsonl')
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	test('extracts last user prompt', async () => {
		const transcript = [
			{ type: 'user', message: { role: 'user', content: 'first prompt' } },
			{ type: 'assistant', message: { role: 'assistant', content: 'response' } },
			{ type: 'user', message: { role: 'user', content: 'second prompt' } },
		]
			.map((line) => JSON.stringify(line))
			.join('\n')

		await writeFile(transcriptPath, transcript)
		expect(await getLastUserPrompt(transcriptPath)).toBe('second prompt')
	})

	test('returns null on missing file', async () => {
		expect(await getLastUserPrompt('/nonexistent/path.jsonl')).toBeNull()
	})
})

describe('message helpers', () => {
	test('truncateForSubject truncates with ellipsis', () => {
		expect(truncateForSubject('hello world', 8)).toBe('hello...')
	})

	test('generateCommitMessage fallback', () => {
		const message = generateCommitMessage(null)
		expect(message).toContain('chore(wip): session checkpoint')
	})
})

describe('getGitStatus + createAutoCommit', () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = join(tmpdir(), `git-commit-test-${Date.now()}`)
		await mkdir(tempDir, { recursive: true })

		await Bun.spawn(['git', 'init'], { cwd: tempDir }).exited
		await Bun.spawn(['git', 'config', 'user.name', 'Test User'], {
			cwd: tempDir,
		}).exited
		await Bun.spawn(['git', 'config', 'user.email', 'test@example.com'], {
			cwd: tempDir,
		}).exited
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	test('returns null outside git repo', async () => {
		expect(await getGitStatus('/tmp')).toBeNull()
	})

	test('creates commit for tracked changes only', async () => {
		await writeFile(join(tempDir, 'tracked.txt'), 'tracked')
		await Bun.spawn(['git', 'add', 'tracked.txt'], { cwd: tempDir }).exited
		await Bun.spawn(['git', 'commit', '-m', 'initial'], { cwd: tempDir }).exited

		await writeFile(join(tempDir, 'tracked.txt'), 'modified')
		await writeFile(join(tempDir, 'untracked.txt'), 'new file')

		const message = generateCommitMessage('checkpoint')
		expect(await createAutoCommit(tempDir, message)).toBe(true)

		const changedStatus = await getGitStatus(tempDir)
		expect(changedStatus?.untracked).toBe(1)
	})
})

describe('printUserNotification', () => {
	test('prints checkpoint message', () => {
		const calls: string[] = []
		const original = console.log
		console.log = (...args: unknown[]) => {
			calls.push(args.join(' '))
		}

		try {
			printUserNotification('chore(wip): checkpoint\n\nbody')
		} finally {
			console.log = original
		}

		expect(calls[0]).toContain('WIP checkpoint saved')
	})
})
