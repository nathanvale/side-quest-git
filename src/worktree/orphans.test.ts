import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { listOrphanBranches } from './orphans.js'

describe('listOrphanBranches', () => {
	let tmpDir: string
	let gitRoot: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
		gitRoot = tmpDir

		// Initialize a git repo with an initial commit
		await spawnAndCollect(['git', 'init', '-b', 'main'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(gitRoot, 'file.txt'), 'initial')
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

	test('lists branches without worktrees', async () => {
		// Create a branch, don't create worktree for it
		await spawnAndCollect(['git', 'branch', 'orphan-branch'], {
			cwd: gitRoot,
		})

		const orphans = await listOrphanBranches(gitRoot)
		expect(orphans.length).toBe(1)
		expect(orphans[0]!.branch).toBe('orphan-branch')
	})

	test('excludes protected branches', async () => {
		// main is the default branch, should be excluded
		const orphans = await listOrphanBranches(gitRoot)
		const mainOrphan = orphans.find((o) => o.branch === 'main')
		expect(mainOrphan).toBeUndefined()
	})

	test('identifies merged branches', async () => {
		// Create and merge a branch
		await spawnAndCollect(['git', 'checkout', '-b', 'feature'], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(gitRoot, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'feature'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'checkout', 'main'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'merge', 'feature'], {
			cwd: gitRoot,
		})

		const orphans = await listOrphanBranches(gitRoot)
		const featureOrphan = orphans.find((o) => o.branch === 'feature')
		expect(featureOrphan).toBeDefined()
		expect(featureOrphan!.merged).toBe(true)
		expect(featureOrphan!.status).toBe('merged')
	})

	test('counts commits ahead accurately', async () => {
		await spawnAndCollect(['git', 'checkout', '-b', 'ahead-branch'], { cwd: gitRoot })
		fs.writeFileSync(path.join(gitRoot, 'a.txt'), 'a')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'commit 1'], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(gitRoot, 'b.txt'), 'b')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'commit 2'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'checkout', 'main'], {
			cwd: gitRoot,
		})

		const orphans = await listOrphanBranches(gitRoot)
		const ahead = orphans.find((o) => o.branch === 'ahead-branch')
		expect(ahead).toBeDefined()
		expect(ahead!.status).toBe('ahead')
		expect(ahead!.commitsAhead).toBe(2)
	})

	test('returns empty when all branches have worktrees', async () => {
		// No extra branches, just main (which is protected)
		const orphans = await listOrphanBranches(gitRoot)
		expect(orphans.length).toBe(0)
	})

	test('respects custom protected branches', async () => {
		await spawnAndCollect(['git', 'branch', 'develop'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'branch', 'staging'], {
			cwd: gitRoot,
		})

		// With default protected: develop should be excluded
		const defaultOrphans = await listOrphanBranches(gitRoot)
		expect(defaultOrphans.find((o) => o.branch === 'develop')).toBeUndefined()
		expect(defaultOrphans.find((o) => o.branch === 'staging')).toBeDefined()

		// With custom protected: staging should be excluded
		const customOrphans = await listOrphanBranches(gitRoot, {
			protectedBranches: ['main', 'staging'],
		})
		expect(customOrphans.find((o) => o.branch === 'staging')).toBeUndefined()
		expect(customOrphans.find((o) => o.branch === 'develop')).toBeDefined()
	})
})
