import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { listWorktrees } from './list.js'

describe('listWorktrees', () => {
	let tmpDir: string
	let gitRoot: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
		gitRoot = tmpDir

		// Initialize a git repo with an initial commit
		await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: gitRoot,
		})
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
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('lists the main worktree', async () => {
		const worktrees = await listWorktrees(gitRoot)

		expect(worktrees).toHaveLength(1)
		expect(worktrees[0]!.branch).toBe('main')
		expect(worktrees[0]!.isMain).toBe(true)
		expect(worktrees[0]!.path).toBe(gitRoot)
	})

	test('lists additional worktrees', async () => {
		// Create a worktree
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-test')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/test', wtPath], { cwd: gitRoot })

		const worktrees = await listWorktrees(gitRoot)

		expect(worktrees).toHaveLength(2)

		const feature = worktrees.find((w) => w.branch === 'feat/test')
		expect(feature).toBeDefined()
		expect(feature!.path).toBe(wtPath)
		expect(feature!.isMain).toBe(false)
	})

	test('detects dirty worktrees', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-dirty')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/dirty', wtPath], { cwd: gitRoot })

		// Make the worktree dirty
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'uncommitted')

		const worktrees = await listWorktrees(gitRoot)
		const dirty = worktrees.find((w) => w.branch === 'feat/dirty')

		expect(dirty).toBeDefined()
		expect(dirty!.dirty).toBe(true)
	})

	test('detects clean worktrees', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-clean')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/clean', wtPath], { cwd: gitRoot })

		const worktrees = await listWorktrees(gitRoot)
		const clean = worktrees.find((w) => w.branch === 'feat/clean')

		expect(clean).toBeDefined()
		expect(clean!.dirty).toBe(false)
	})

	test('detects merged branches', async () => {
		// Create a branch, commit, merge it back
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-merged')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/merged', wtPath], { cwd: gitRoot })
		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'add feature'], {
			cwd: wtPath,
		})

		// Merge into main
		await spawnAndCollect(['git', 'merge', 'feat/merged'], {
			cwd: gitRoot,
		})

		const worktrees = await listWorktrees(gitRoot)
		const merged = worktrees.find((w) => w.branch === 'feat/merged')

		expect(merged).toBeDefined()
		expect(merged!.merged).toBe(true)
	})

	test('includes short SHA for head', async () => {
		const worktrees = await listWorktrees(gitRoot)
		expect(worktrees[0]!.head).toHaveLength(7)
	})

	test('main worktree has no commitsAhead or status', async () => {
		const worktrees = await listWorktrees(gitRoot)
		const main = worktrees.find((w) => w.isMain)

		expect(main).toBeDefined()
		expect(main!.commitsAhead).toBeUndefined()
		expect(main!.status).toBeUndefined()
	})

	test('clean feature branch shows pristine status', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-pristine')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/pristine', wtPath], {
			cwd: gitRoot,
		})

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/pristine')

		expect(feature).toBeDefined()
		expect(feature!.commitsAhead).toBe(0)
		expect(feature!.status).toBe('pristine')
	})

	test('dirty feature branch shows dirty status', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-dirty-status')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/dirty-status', wtPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'uncommitted')

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/dirty-status')

		expect(feature).toBeDefined()
		expect(feature!.commitsAhead).toBe(0)
		expect(feature!.status).toBe('dirty')
	})

	test('branch with commits ahead shows ahead count', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-ahead')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/ahead', wtPath], { cwd: gitRoot })
		fs.writeFileSync(path.join(wtPath, 'file1.txt'), 'commit 1')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'commit 1'], {
			cwd: wtPath,
		})
		fs.writeFileSync(path.join(wtPath, 'file2.txt'), 'commit 2')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'commit 2'], {
			cwd: wtPath,
		})

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/ahead')

		expect(feature).toBeDefined()
		expect(feature!.commitsAhead).toBe(2)
		expect(feature!.status).toBe('2 ahead')
	})

	test('branch with commits ahead and dirty shows combined status', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-ahead-dirty')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/ahead-dirty', wtPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(wtPath, 'file1.txt'), 'commit 1')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'commit 1'], {
			cwd: wtPath,
		})
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'uncommitted')

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/ahead-dirty')

		expect(feature).toBeDefined()
		expect(feature!.commitsAhead).toBe(1)
		expect(feature!.status).toBe('1 ahead, dirty')
	})

	test('merged branch shows merged status', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-merged-status')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/merged-status', wtPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'add feature'], {
			cwd: wtPath,
		})
		await spawnAndCollect(
			['git', 'merge', '--no-ff', '-m', 'Merge feat/merged-status', 'feat/merged-status'],
			{
				cwd: gitRoot,
			},
		)

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/merged-status')

		expect(feature).toBeDefined()
		expect(feature!.status).toBe('merged')
	})

	test('merged dirty branch behind main shows merged, dirty status', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-merged-dirty-behind')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/merged-dirty-behind', wtPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'add feature'], {
			cwd: wtPath,
		})
		await spawnAndCollect(
			[
				'git',
				'merge',
				'--no-ff',
				'-m',
				'Merge feat/merged-dirty-behind',
				'feat/merged-dirty-behind',
			],
			{
				cwd: gitRoot,
			},
		)
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'uncommitted')

		const worktrees = await listWorktrees(gitRoot)
		const feature = worktrees.find((w) => w.branch === 'feat/merged-dirty-behind')

		expect(feature).toBeDefined()
		expect(feature!.merged).toBe(true)
		expect(feature!.dirty).toBe(true)
		expect(feature!.commitsAhead).toBe(0)
		expect(feature!.status).toBe('merged, dirty')
	})
})
