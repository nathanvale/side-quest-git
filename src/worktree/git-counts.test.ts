import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { getAheadBehindCounts } from './git-counts.js'

let dirs: string[] = []

afterEach(() => {
	for (const dir of dirs) {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	dirs = []
})

/**
 * Initialize a git repository with an initial commit on main.
 */
async function initRepo(): Promise<string> {
	const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-counts-'))
	dirs.push(tmpDir)

	await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: tmpDir })
	await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
		cwd: tmpDir,
	})
	await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
		cwd: tmpDir,
	})
	fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test')
	await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
	await spawnAndCollect(['git', 'commit', '-m', 'initial'], { cwd: tmpDir })

	return tmpDir
}

/**
 * Create a feature branch with N commits then return to main.
 */
async function createFeatureCommits(gitRoot: string, branch: string, count: number): Promise<void> {
	await spawnAndCollect(['git', 'checkout', '-b', branch], { cwd: gitRoot })
	for (let i = 1; i <= count; i++) {
		fs.writeFileSync(path.join(gitRoot, `file${i}.txt`), `content ${i}`)
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', `commit ${i}`], {
			cwd: gitRoot,
		})
	}
	await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })
}

describe('getAheadBehindCounts - happy path', () => {
	test('branch with N commits ahead of main returns correct counts', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 3)

		const result = await getAheadBehindCounts(gitRoot, 'feature', 'main')

		expect(result.ahead).toBe(3)
		expect(result.behind).toBe(0)
	})

	test('branch diverged from main returns both ahead and behind', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		// Advance main independently so feature is also behind
		fs.writeFileSync(path.join(gitRoot, 'main-extra.txt'), 'extra')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'main advance'], {
			cwd: gitRoot,
		})

		const result = await getAheadBehindCounts(gitRoot, 'feature', 'main')

		expect(result.ahead).toBe(2)
		expect(result.behind).toBe(1)
	})

	test('same-tip branches return zero for both counts', async () => {
		const gitRoot = await initRepo()

		const result = await getAheadBehindCounts(gitRoot, 'main', 'main')

		expect(result.ahead).toBe(0)
		expect(result.behind).toBe(0)
	})

	test('fully-qualified refs work the same as plain names', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const plain = await getAheadBehindCounts(gitRoot, 'feature', 'main')
		const qualified = await getAheadBehindCounts(gitRoot, 'refs/heads/feature', 'refs/heads/main')

		expect(plain.ahead).toBe(qualified.ahead)
		expect(plain.behind).toBe(qualified.behind)
	})
})

describe('getAheadBehindCounts - error handling', () => {
	test('non-existent branch returns { ahead: 0, behind: 0 }', async () => {
		const gitRoot = await initRepo()

		const result = await getAheadBehindCounts(gitRoot, 'nonexistent-branch', 'main')

		// Fail-safe: returns zeros, never throws
		expect(result.ahead).toBe(0)
		expect(result.behind).toBe(0)
	})

	test('non-existent base branch returns { ahead: 0, behind: 0 }', async () => {
		const gitRoot = await initRepo()

		const result = await getAheadBehindCounts(gitRoot, 'main', 'nonexistent-base')

		expect(result.ahead).toBe(0)
		expect(result.behind).toBe(0)
	})

	test('non-git directory returns { ahead: 0, behind: 0 }', async () => {
		const { tmpdir } = await import('node:os')
		const nonGitDir = fs.mkdtempSync(path.join(tmpdir(), '.test-nongit-counts-'))
		dirs.push(nonGitDir)

		const result = await getAheadBehindCounts(nonGitDir, 'main', 'main')

		expect(result.ahead).toBe(0)
		expect(result.behind).toBe(0)
	})
})

describe('getAheadBehindCounts - AbortSignal', () => {
	test('non-aborted signal does not affect normal operation', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const controller = new AbortController()
		const result = await getAheadBehindCounts(gitRoot, 'feature', 'main', controller.signal)

		expect(result.ahead).toBe(2)
		expect(result.behind).toBe(0)
	})

	test('already-aborted signal returns { ahead: 0, behind: 0 } without throwing', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const controller = new AbortController()
		controller.abort()

		// Should not throw -- fail-safe return
		const result = await getAheadBehindCounts(gitRoot, 'feature', 'main', controller.signal)

		expect(result.ahead).toBe(0)
		expect(result.behind).toBe(0)
	})
})
