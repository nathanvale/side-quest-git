import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { cleanWorktrees } from './clean.js'

describe('cleanWorktrees', () => {
	let tmpDir: string
	let gitRoot: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
		gitRoot = tmpDir

		await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: gitRoot })
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
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('deletes merged and clean worktrees', async () => {
		// Create a worktree, merge its changes, then clean
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-merged')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-merged', wtPath], { cwd: gitRoot })

		// Make it merged (it's at same commit as main)
		const result = await cleanWorktrees(gitRoot)

		const deletedBranches = result.deleted.map((d) => d.branch)
		expect(deletedBranches).toContain('feat-merged')
	})

	test('skips dirty worktrees without force', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-dirty')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-dirty', wtPath], { cwd: gitRoot })

		// Make it dirty
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'dirty')

		const result = await cleanWorktrees(gitRoot)
		const skippedBranches = result.skipped.map((s) => s.branch)
		expect(skippedBranches).toContain('feat-dirty')
		const dirtySkip = result.skipped.find((s) => s.branch === 'feat-dirty')
		expect(dirtySkip?.reason).toBe('dirty')
	})

	test('never deletes main worktree even with force', async () => {
		const result = await cleanWorktrees(gitRoot, { force: true })
		const mainSkip = result.skipped.find((s) => s.reason === 'is-main')
		expect(mainSkip).toBeDefined()
	})

	test('dry run returns counts without deleting', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-dryrun')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-dryrun', wtPath], { cwd: gitRoot })

		const result = await cleanWorktrees(gitRoot, { dryRun: true })
		expect(result.dryRun).toBe(true)
		expect(result.deleted.length).toBeGreaterThanOrEqual(1)

		// Verify worktree still exists
		expect(fs.existsSync(wtPath)).toBe(true)
	})

	test('force deletes dirty worktrees', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-force')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-force', wtPath], { cwd: gitRoot })
		fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'dirty')

		const result = await cleanWorktrees(gitRoot, { force: true })
		const deletedBranches = result.deleted.map((d) => d.branch)
		expect(deletedBranches).toContain('feat-force')
	})

	test('delete-branches flag calls git branch -d', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-branch-del')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-branch-del', wtPath], {
			cwd: gitRoot,
		})

		const result = await cleanWorktrees(gitRoot, {
			deleteBranches: true,
		})
		const del = result.deleted.find((d) => d.branch === 'feat-branch-del')
		expect(del?.branchDeleted).toBe(true)
	})
})
