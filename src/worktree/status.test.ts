import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { getWorktreeStatus } from './status.js'

describe('getWorktreeStatus', () => {
	let tmpDir: string
	let gitRoot: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
		gitRoot = tmpDir

		// Initialize a git repo with an initial commit
		await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(gitRoot, 'README.md'), '# Test')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], {
			cwd: gitRoot,
		})
	})

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	test('returns status for worktrees with correct fields', async () => {
		const statuses = await getWorktreeStatus(gitRoot)

		expect(statuses.length).toBeGreaterThanOrEqual(1)

		const main = statuses.find((s) => s.branch === 'main')
		expect(main).toBeDefined()
		expect(main!.path).toBe(gitRoot)
		expect(main!.isMain).toBe(true)
		expect(typeof main!.dirty).toBe('boolean')
		expect(typeof main!.commitsAhead).toBe('number')
		expect(typeof main!.commitsBehind).toBe('number')
	})

	test('commitsAhead and commitsBehind are numbers', async () => {
		// Create a worktree with commits ahead of main
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-ahead')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/ahead', wtPath], { cwd: gitRoot })
		fs.writeFileSync(path.join(wtPath, 'a.txt'), 'a')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'ahead commit 1'], {
			cwd: wtPath,
		})
		fs.writeFileSync(path.join(wtPath, 'b.txt'), 'b')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'ahead commit 2'], {
			cwd: wtPath,
		})

		const statuses = await getWorktreeStatus(gitRoot)
		const ahead = statuses.find((s) => s.branch === 'feat/ahead')

		expect(ahead).toBeDefined()
		expect(typeof ahead!.commitsAhead).toBe('number')
		expect(typeof ahead!.commitsBehind).toBe('number')
		expect(ahead!.commitsAhead).toBe(2)
		expect(ahead!.commitsBehind).toBe(0)
	})

	test('lastCommitAt is ISO timestamp', async () => {
		const statuses = await getWorktreeStatus(gitRoot)
		const main = statuses.find((s) => s.branch === 'main')

		expect(main).toBeDefined()
		expect(main!.lastCommitAt).not.toBeNull()
		// ISO 8601 format: YYYY-MM-DDTHH:MM:SS+HH:MM
		expect(main!.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
	})

	test('lastCommitMessage is a string', async () => {
		const statuses = await getWorktreeStatus(gitRoot)
		const main = statuses.find((s) => s.branch === 'main')

		expect(main).toBeDefined()
		expect(main!.lastCommitMessage).toBe('initial')
	})

	test('PR info is null when includePr is false (default)', async () => {
		const statuses = await getWorktreeStatus(gitRoot)

		for (const status of statuses) {
			expect(status.pr).toBeNull()
		}
	})

	test('handles missing upstream branch gracefully', async () => {
		// Create a worktree on a branch with no upstream
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-no-upstream')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/no-upstream', wtPath], {
			cwd: gitRoot,
		})

		const statuses = await getWorktreeStatus(gitRoot)
		const noUpstream = statuses.find((s) => s.branch === 'feat/no-upstream')

		expect(noUpstream).toBeDefined()
		// Should not throw, ahead/behind should be numbers
		expect(typeof noUpstream!.commitsAhead).toBe('number')
		expect(typeof noUpstream!.commitsBehind).toBe('number')
	})

	test('main branch has zero ahead/behind', async () => {
		const statuses = await getWorktreeStatus(gitRoot)
		const main = statuses.find((s) => s.branch === 'main')

		expect(main).toBeDefined()
		expect(main!.commitsAhead).toBe(0)
		expect(main!.commitsBehind).toBe(0)
	})

	test('detects dirty worktrees', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-dirty')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/dirty', wtPath], { cwd: gitRoot })
		fs.writeFileSync(path.join(wtPath, 'uncommitted.txt'), 'dirty')

		const statuses = await getWorktreeStatus(gitRoot)
		const dirty = statuses.find((s) => s.branch === 'feat/dirty')

		expect(dirty).toBeDefined()
		expect(dirty!.dirty).toBe(true)
	})
})
