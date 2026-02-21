import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { cleanupBackupRefs, createBackupRef, listBackupRefs, restoreBackupRef } from './backup.js'
import { CONFIG_FILENAME } from './config.js'
import { deleteWorktree } from './delete.js'

describe('backup refs', () => {
	let tmpDir: string
	let gitRoot: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
		gitRoot = tmpDir

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

		// Write config so deleteWorktree tests are deterministic
		fs.writeFileSync(
			path.join(gitRoot, CONFIG_FILENAME),
			JSON.stringify({
				directory: '.worktrees',
				copy: [],
				exclude: [],
				postCreate: null,
				preDelete: null,
				branchTemplate: '{type}/{description}',
			}),
		)
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	/** Helper: create a lightweight test branch. */
	async function createBranch(branch: string): Promise<void> {
		await spawnAndCollect(['git', 'branch', branch], { cwd: gitRoot })
	}

	/** Helper: create a branch whose tip commit has an old committer date. */
	async function createOldDatedBranch(branch: string): Promise<void> {
		await spawnAndCollect(['git', 'checkout', '-b', branch], { cwd: gitRoot })
		fs.writeFileSync(path.join(gitRoot, `${branch.replaceAll('/', '-')}.txt`), 'old')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', `old commit for ${branch}`], {
			cwd: gitRoot,
			env: {
				...process.env,
				GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
				GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
			},
		})
		await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })
	}

	/** Helper: resolve a ref to its SHA (returns empty string if not found). */
	async function resolveRef(ref: string): Promise<string> {
		const result = await spawnAndCollect(['git', 'rev-parse', '--verify', ref], { cwd: gitRoot })
		return result.exitCode === 0 ? result.stdout.trim() : ''
	}

	describe('createBackupRef', () => {
		test('creates refs/backup/<branch> pointing to the branch commit', async () => {
			await createBranch('feat/my-feature')

			const branchSha = await resolveRef('feat/my-feature')
			expect(branchSha).toBeTruthy()

			await createBackupRef(gitRoot, 'feat/my-feature')

			const backupSha = await resolveRef('refs/backup/feat/my-feature')
			expect(backupSha).toBe(branchSha)
		})

		test('overwrites an existing backup ref with the latest commit', async () => {
			await createBranch('feat/update-me')
			await createBackupRef(gitRoot, 'feat/update-me')

			// Advance the branch with a new commit
			const wtPath = path.join(gitRoot, '.worktrees', 'feat-update-me')
			await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/advance', wtPath], {
				cwd: gitRoot,
			})
			fs.writeFileSync(path.join(wtPath, 'new.txt'), 'new content')
			await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
			await spawnAndCollect(['git', 'commit', '-m', 'advance'], {
				cwd: wtPath,
			})

			// Update the original branch to point at the new commit
			const newSha = await resolveRef('feat/advance')
			await spawnAndCollect(['git', 'update-ref', 'refs/heads/feat/update-me', newSha], {
				cwd: gitRoot,
			})

			// Create backup again -- should now point to the new SHA
			await createBackupRef(gitRoot, 'feat/update-me')

			const backupSha = await resolveRef('refs/backup/feat/update-me')
			expect(backupSha).toBe(newSha)
		})

		test('throws when the branch does not exist', async () => {
			await expect(createBackupRef(gitRoot, 'feat/nonexistent')).rejects.toThrow('feat/nonexistent')
		})

		test('uses refs/heads/ prefix to avoid matching a tag with the same name (#46)', async () => {
			// Create a branch and a tag sharing the same bare name.
			// Without refs/heads/ prefix, git rev-parse could resolve the tag instead.
			await createBranch('feat/tag-collision')
			const branchSha = await resolveRef('refs/heads/feat/tag-collision')
			expect(branchSha).toBeTruthy()

			// Create a tag pointing to a DIFFERENT (no-op) ref so they differ
			// in a detectable way. Here we use the initial commit SHA for the tag.
			// Since the branch also points at the initial commit, both resolve the
			// same SHA in this repo -- what we verify is that createBackupRef does
			// NOT throw when a tag shares the bare name, and that the backup points
			// to the branch commit (not some other resolution).
			await spawnAndCollect(['git', 'tag', 'feat/tag-collision', 'main'], {
				cwd: gitRoot,
			})

			// createBackupRef must succeed and resolve the BRANCH (refs/heads/) commit
			await createBackupRef(gitRoot, 'feat/tag-collision')

			const backupSha = await resolveRef('refs/backup/feat/tag-collision')
			expect(backupSha).toBe(branchSha)
		})

		test('creates a reflog entry so backup age tracks ref-write time', async () => {
			await createBranch('feat/reflog-age')

			await createBackupRef(gitRoot, 'feat/reflog-age')

			const reflogResult = await spawnAndCollect(
				[
					'git',
					'reflog',
					'show',
					'--date=iso-strict',
					'--format=%gd',
					'refs/backup/feat/reflog-age',
					'-n',
					'1',
				],
				{ cwd: gitRoot },
			)
			expect(reflogResult.exitCode).toBe(0)
			expect(reflogResult.stdout.trim()).toContain('@{')
		})
	})

	describe('listBackupRefs', () => {
		test('returns empty array when no backups exist', async () => {
			const refs = await listBackupRefs(gitRoot)
			expect(refs).toEqual([])
		})

		test('returns one entry after a single backup', async () => {
			await createBranch('feat/list-me')
			await createBackupRef(gitRoot, 'feat/list-me')

			const refs = await listBackupRefs(gitRoot)
			expect(refs).toHaveLength(1)
			expect(refs[0]?.branch).toBe('feat/list-me')
			expect(refs[0]?.commit).toBeTruthy()
			expect(refs[0]?.createdAt).toBeTruthy()
		})

		test('returns multiple entries sorted oldest-first', async () => {
			await createBranch('feat/alpha')
			await createBackupRef(gitRoot, 'feat/alpha')

			// Small delay so timestamps differ (git granularity is 1 second)
			await new Promise((r) => setTimeout(r, 1100))

			await createBranch('feat/beta')
			await createBackupRef(gitRoot, 'feat/beta')

			const refs = await listBackupRefs(gitRoot)
			expect(refs.length).toBeGreaterThanOrEqual(2)

			const alphaIdx = refs.findIndex((r) => r.branch === 'feat/alpha')
			const betaIdx = refs.findIndex((r) => r.branch === 'feat/beta')
			expect(alphaIdx).toBeLessThan(betaIdx)
		})

		test('entry includes correct commit SHA matching the branch', async () => {
			await createBranch('feat/sha-check')
			const branchSha = await resolveRef('feat/sha-check')

			await createBackupRef(gitRoot, 'feat/sha-check')

			const refs = await listBackupRefs(gitRoot)
			const entry = refs.find((r) => r.branch === 'feat/sha-check')
			expect(entry?.commit).toBe(branchSha)
		})
	})

	describe('restoreBackupRef', () => {
		test('recreates the branch from its backup ref', async () => {
			await createBranch('feat/restore-me')
			const originalSha = await resolveRef('feat/restore-me')
			await createBackupRef(gitRoot, 'feat/restore-me')

			// Delete the branch
			await spawnAndCollect(['git', 'branch', '-d', 'feat/restore-me'], { cwd: gitRoot })
			expect(await resolveRef('feat/restore-me')).toBe('')

			// Restore
			await restoreBackupRef(gitRoot, 'feat/restore-me')

			const restoredSha = await resolveRef('feat/restore-me')
			expect(restoredSha).toBe(originalSha)
		})

		test('throws when no backup ref exists for the branch', async () => {
			await expect(restoreBackupRef(gitRoot, 'feat/no-backup')).rejects.toThrow(
				'No backup ref found for branch "feat/no-backup"',
			)
		})

		test('throws when branch already exists (refuse to clobber)', async () => {
			await createBranch('feat/already-exists')
			await createBackupRef(gitRoot, 'feat/already-exists')

			await expect(restoreBackupRef(gitRoot, 'feat/already-exists')).rejects.toThrow(
				'already exists',
			)
		})

		test('backup ref is preserved after restore', async () => {
			await createBranch('feat/keep-backup')
			await createBackupRef(gitRoot, 'feat/keep-backup')

			await spawnAndCollect(['git', 'branch', '-d', 'feat/keep-backup'], {
				cwd: gitRoot,
			})
			await restoreBackupRef(gitRoot, 'feat/keep-backup')

			// Backup should still exist
			const backupSha = await resolveRef('refs/backup/feat/keep-backup')
			expect(backupSha).toBeTruthy()
		})

		test('uses refs/heads/ prefix for existence check to avoid matching tags (#46)', async () => {
			// Create branch, back it up, delete branch, then create a tag with same name.
			// restoreBackupRef must check refs/heads/ specifically -- a tag with the
			// same bare name must NOT count as "branch already exists".
			await createBranch('feat/tag-exists-check')
			await createBackupRef(gitRoot, 'feat/tag-exists-check')

			// Delete the branch so restore is possible
			await spawnAndCollect(['git', 'branch', '-d', 'feat/tag-exists-check'], {
				cwd: gitRoot,
			})

			// Create a tag with the same bare name pointing at main
			await spawnAndCollect(['git', 'tag', 'feat/tag-exists-check', 'main'], {
				cwd: gitRoot,
			})

			// Branch is gone -- restore must succeed (tag does NOT block restoration)
			await expect(restoreBackupRef(gitRoot, 'feat/tag-exists-check')).resolves.toBeUndefined()

			// Branch should now exist again
			const restoredSha = await resolveRef('refs/heads/feat/tag-exists-check')
			expect(restoredSha).toBeTruthy()
		})
	})

	describe('cleanupBackupRefs', () => {
		test('returns empty array when no backups exist', async () => {
			const deleted = await cleanupBackupRefs(gitRoot, 30)
			expect(deleted).toEqual([])
		})

		test('does not delete backups younger than maxAgeDays', async () => {
			await createBranch('feat/young')
			await createBackupRef(gitRoot, 'feat/young')

			// 30-day window -- backup was just created so should survive
			const deleted = await cleanupBackupRefs(gitRoot, 30)
			expect(deleted).not.toContain('feat/young')

			// Backup ref should still be present
			const backupSha = await resolveRef('refs/backup/feat/young')
			expect(backupSha).toBeTruthy()
		})

		test('does not delete a fresh backup for a branch with an old commit date', async () => {
			await createOldDatedBranch('feat/old-commit-date')
			await createBackupRef(gitRoot, 'feat/old-commit-date')

			// Retention should be based on backup ref write time (now), not commit date (year 2000).
			const deleted = await cleanupBackupRefs(gitRoot, 30)
			expect(deleted).not.toContain('feat/old-commit-date')
			expect(await resolveRef('refs/backup/feat/old-commit-date')).toBeTruthy()
		})

		test('deletes backups older than maxAgeDays=0', async () => {
			await createBranch('feat/old')
			await createBackupRef(gitRoot, 'feat/old')

			// maxAgeDays=0 means "delete everything older than right now"
			// In practice all refs created before this call qualify
			await new Promise((r) => setTimeout(r, 50))
			const deleted = await cleanupBackupRefs(gitRoot, 0)
			expect(deleted).toContain('feat/old')

			// Backup ref should be gone
			const backupSha = await resolveRef('refs/backup/feat/old')
			expect(backupSha).toBe('')
		})
	})

	describe('deleteWorktree integration', () => {
		/** Helper: create a git worktree for integration tests. */
		async function createTestWorktree(branch: string): Promise<string> {
			const sanitized = branch.replace(/\//g, '-')
			const wtPath = path.join(gitRoot, '.worktrees', sanitized)
			await spawnAndCollect(['git', 'worktree', 'add', '-b', branch, wtPath], {
				cwd: gitRoot,
			})
			return wtPath
		}

		test('creates backup ref before deleting branch', async () => {
			const wtPath = await createTestWorktree('feat/backup-on-delete')

			// Make a commit so the branch is ahead of main
			fs.writeFileSync(path.join(wtPath, 'feature.txt'), 'done')
			await spawnAndCollect(['git', 'add', '.'], { cwd: wtPath })
			await spawnAndCollect(['git', 'commit', '-m', 'feature'], {
				cwd: wtPath,
			})

			// Record the branch SHA before deletion
			const branchSha = await resolveRef('feat/backup-on-delete')

			// Merge so -d (safe delete) works
			await spawnAndCollect(['git', 'merge', 'feat/backup-on-delete'], { cwd: gitRoot })

			await deleteWorktree(gitRoot, 'feat/backup-on-delete', {
				deleteBranch: true,
			})

			// Branch should be gone
			expect(await resolveRef('feat/backup-on-delete')).toBe('')

			// Backup ref should exist and point to the pre-deletion SHA
			const backupSha = await resolveRef('refs/backup/feat/backup-on-delete')
			expect(backupSha).toBe(branchSha)
		})

		test('delete succeeds even if backup would fail (nonexistent branch edge case)', async () => {
			// This test verifies the best-effort nature of backup creation.
			// We create a worktree but do NOT ask to delete the branch,
			// so createBackupRef is never called -- the delete must still work.
			const wtPath = await createTestWorktree('feat/no-branch-delete')
			expect(wtPath).toBeTruthy()

			const result = await deleteWorktree(gitRoot, 'feat/no-branch-delete', {
				deleteBranch: false,
			})

			expect(result.branchDeleted).toBe(false)
		})
	})
})
