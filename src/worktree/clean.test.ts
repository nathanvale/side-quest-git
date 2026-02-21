import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { listBackupRefs } from './backup.js'
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

	test('squash-merged worktree is cleaned', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-squash-merged')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-squash-merged', wtPath], {
			cwd: gitRoot,
		})

		// Add commits to the feature branch
		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature work')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'feature work'], {
			cwd: wtPath,
		})

		// Squash-merge the feature branch into main
		await spawnAndCollect(['git', 'merge', '--squash', 'feat-squash-merged'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'squash merge feat-squash-merged'], {
			cwd: gitRoot,
		})

		// Assert preconditions: branch is NOT an ancestor (squash creates new SHA)
		const ancestorCheck = await spawnAndCollect(
			['git', 'merge-base', '--is-ancestor', 'feat-squash-merged', 'main'],
			{ cwd: gitRoot },
		)
		expect(ancestorCheck.exitCode).toBe(1)

		// Clean should detect the squash-merge and delete the worktree
		const result = await cleanWorktrees(gitRoot)

		const deletedBranches = result.deleted.map((d) => d.branch)
		expect(deletedBranches).toContain('feat-squash-merged')
	})

	test('deleteBranches with squash-merged branch deletes worktree but branch needs force', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-squash-del')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-squash-del', wtPath], {
			cwd: gitRoot,
		})

		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'feature'], {
			cwd: wtPath,
		})

		await spawnAndCollect(['git', 'merge', '--squash', 'feat-squash-del'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'squash merge feat-squash-del'], { cwd: gitRoot })

		const result = await cleanWorktrees(gitRoot, { deleteBranches: true })

		const deleted = result.deleted.find((d) => d.branch === 'feat-squash-del')
		expect(deleted).toBeDefined()
		// git branch -d fails for squash-merged branches (git thinks unmerged)
		expect(deleted!.branchDeleted).toBe(false)
	})

	test('force + deleteBranches deletes squash-merged branch with -D', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-squash-force')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-squash-force', wtPath], {
			cwd: gitRoot,
		})

		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'feature'], {
			cwd: wtPath,
		})

		await spawnAndCollect(['git', 'merge', '--squash', 'feat-squash-force'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'squash merge feat-squash-force'], {
			cwd: gitRoot,
		})

		const result = await cleanWorktrees(gitRoot, {
			force: true,
			deleteBranches: true,
		})

		const deleted = result.deleted.find((d) => d.branch === 'feat-squash-force')
		expect(deleted).toBeDefined()
		expect(deleted!.branchDeleted).toBe(true)

		// Verify branch is actually gone
		const branchCheck = await spawnAndCollect(
			['git', 'rev-parse', '--verify', 'feat-squash-force'],
			{ cwd: gitRoot },
		)
		expect(branchCheck.exitCode).not.toBe(0)
	})

	test('unmerged branch is skipped even with squash detection', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-unmerged')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-unmerged', wtPath], {
			cwd: gitRoot,
		})

		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'unmerged work')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'unmerged work'], {
			cwd: wtPath,
		})

		// Do NOT merge - this branch is genuinely unmerged
		const result = await cleanWorktrees(gitRoot)

		const skipped = result.skipped.find((s) => s.branch === 'feat-unmerged')
		expect(skipped).toBeDefined()
		expect(skipped!.reason).toBe('unmerged')
	})

	test('multi-commit squash-merged worktree is cleaned', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-multi-squash')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-multi-squash', wtPath], {
			cwd: gitRoot,
		})

		// Create multiple commits
		for (let i = 1; i <= 3; i++) {
			fs.writeFileSync(path.join(wtPath, `file${i}.txt`), `content ${i}`)
			await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
			await spawnAndCollect(['git', 'commit', '-m', `commit ${i}`], {
				cwd: wtPath,
			})
		}

		// Squash all 3 commits into main
		await spawnAndCollect(['git', 'merge', '--squash', 'feat-multi-squash'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'squash merge feat-multi-squash'], {
			cwd: gitRoot,
		})

		// Assert preconditions
		const ancestorCheck = await spawnAndCollect(
			['git', 'merge-base', '--is-ancestor', 'feat-multi-squash', 'main'],
			{ cwd: gitRoot },
		)
		expect(ancestorCheck.exitCode).toBe(1)

		const result = await cleanWorktrees(gitRoot)
		const deletedBranches = result.deleted.map((d) => d.branch)
		expect(deletedBranches).toContain('feat-multi-squash')
	})

	test('squash-merged worktree clean output includes mergeMethod', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-squash-audit')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-squash-audit', wtPath], {
			cwd: gitRoot,
		})

		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature work')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'feature work'], {
			cwd: wtPath,
		})

		await spawnAndCollect(['git', 'merge', '--squash', 'feat-squash-audit'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'squash merge feat-squash-audit'], {
			cwd: gitRoot,
		})

		const result = await cleanWorktrees(gitRoot)

		const deleted = result.deleted.find((d) => d.branch === 'feat-squash-audit')
		expect(deleted).toBeDefined()
		expect(deleted!.mergeMethod).toBe('squash')
	})

	test('is-main skip has no mergeMethod', async () => {
		const result = await cleanWorktrees(gitRoot)
		const mainSkip = result.skipped.find((s) => s.reason === 'is-main')
		expect(mainSkip).toBeDefined()
		expect(mainSkip!.mergeMethod).toBeUndefined()
	})

	test('unmerged skip includes mergeMethod undefined', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-unmerged-audit')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-unmerged-audit', wtPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'unmerged work')
		await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
		await spawnAndCollect(['git', 'commit', '-m', 'unmerged work'], {
			cwd: wtPath,
		})

		const result = await cleanWorktrees(gitRoot)
		const skipped = result.skipped.find((s) => s.branch === 'feat-unmerged-audit')
		expect(skipped).toBeDefined()
		expect(skipped!.reason).toBe('unmerged')
		expect(skipped!.mergeMethod).toBeUndefined()
	})

	test('custom concurrency option is forwarded and results are correct', async () => {
		// cleanWorktrees forwards concurrency to listWorktrees. Verify that passing
		// concurrency: 1 (serial mode) still produces the expected clean result.
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-clean-conc')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-clean-conc', wtPath], {
			cwd: gitRoot,
		})

		// The worktree is pristine (same commit as main) so it should be deleted
		const result = await cleanWorktrees(gitRoot, { concurrency: 1 })

		const deletedBranches = result.deleted.map((d) => d.branch)
		expect(deletedBranches).toContain('feat-clean-conc')
	})

	test('SIDE_QUEST_CONCURRENCY env var is respected during clean', async () => {
		// Verify env var flows through cleanWorktrees -> listWorktrees.
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-env-clean')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-env-clean', wtPath], {
			cwd: gitRoot,
		})

		const orig = process.env.SIDE_QUEST_CONCURRENCY
		process.env.SIDE_QUEST_CONCURRENCY = '1'

		try {
			const result = await cleanWorktrees(gitRoot)
			// Operation must complete without error -- result is a valid CleanResult
			expect(Array.isArray(result.deleted)).toBe(true)
			expect(Array.isArray(result.skipped)).toBe(true)
		} finally {
			if (orig === undefined) {
				delete process.env.SIDE_QUEST_CONCURRENCY
			} else {
				process.env.SIDE_QUEST_CONCURRENCY = orig
			}
		}
	})

	test('delete-branches creates backup ref before deleting branch (#43)', async () => {
		const wtPath = path.join(gitRoot, '.worktrees', 'feat-backup-check')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-backup-check', wtPath], {
			cwd: gitRoot,
		})

		// The worktree is pristine (same commit as main), so it is eligible for deletion
		await cleanWorktrees(gitRoot, { deleteBranches: true })

		// The backup ref should have been created before branch deletion
		const refs = await listBackupRefs(gitRoot)
		const backupBranches = refs.map((r) => r.branch)
		expect(backupBranches).toContain('feat-backup-check')
	})

	test('orphan delete-branches creates backup ref before deleting orphan (#43)', async () => {
		// Create an orphan branch (branch with no worktree) that is merged
		await spawnAndCollect(['git', 'checkout', '-b', 'feat-orphan-backup'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })

		// The orphan is at same commit as main so merged=true
		await cleanWorktrees(gitRoot, { includeOrphans: true, force: true })

		// Backup ref should exist for the orphan branch
		const refs = await listBackupRefs(gitRoot)
		const backupBranches = refs.map((r) => r.branch)
		expect(backupBranches).toContain('feat-orphan-backup')
	})
})
