import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { CONFIG_FILENAME } from './config.js'
import { createWorktree } from './create.js'

describe('createWorktree', () => {
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

	test('creates a worktree with a new branch', async () => {
		const result = await createWorktree(gitRoot, 'feat/test-feature', {
			noInstall: true,
			noFetch: true,
		})

		expect(result.branch).toBe('feat/test-feature')
		expect(result.path).toContain('.worktrees')
		expect(result.path).toContain('feat-test-feature')
		expect(fs.existsSync(result.path)).toBe(true)

		// Verify git recognizes the worktree
		const listResult = await spawnAndCollect(['git', 'worktree', 'list'], {
			cwd: gitRoot,
		})
		expect(listResult.stdout).toContain('feat/test-feature')
	})

	test('copies configured files to the new worktree', async () => {
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=abc')
		fs.writeFileSync(path.join(gitRoot, '.nvmrc'), '20')

		const config = {
			directory: '.worktrees',
			copy: ['.env', '.nvmrc'],
			exclude: ['node_modules'],
			postCreate: null,
			preDelete: null,
			branchTemplate: '{type}/{description}',
		}
		fs.writeFileSync(path.join(gitRoot, CONFIG_FILENAME), JSON.stringify(config))

		const result = await createWorktree(gitRoot, 'feat/with-files', {
			noInstall: true,
			noFetch: true,
		})

		expect(result.filesCopied).toBe(2)
		expect(fs.readFileSync(path.join(result.path, '.env'), 'utf-8')).toBe('SECRET=abc')
		expect(fs.readFileSync(path.join(result.path, '.nvmrc'), 'utf-8')).toBe('20')
	})

	test('uses auto-detected config when no config file exists', async () => {
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=abc')

		const result = await createWorktree(gitRoot, 'feat/auto-detect', {
			noInstall: true,
			noFetch: true,
		})

		expect(result.configAutoDetected).toBe(true)
		expect(result.filesCopied).toBeGreaterThanOrEqual(1)
	})

	test('throws when worktree already exists and attach is false', async () => {
		await createWorktree(gitRoot, 'feat/existing', {
			noInstall: true,
			noFetch: true,
		})

		await expect(
			createWorktree(gitRoot, 'feat/existing', {
				noInstall: true,
				noFetch: true,
				attach: false,
			}),
		).rejects.toThrow('Worktree already exists')
	})

	test('sanitizes branch name for directory', async () => {
		const result = await createWorktree(gitRoot, 'feat/nested/branch', {
			noInstall: true,
			noFetch: true,
		})

		expect(path.basename(result.path)).toBe('feat-nested-branch')
	})

	test('bases new branch off origin/main when remote exists', async () => {
		// Set up a "remote" by creating a bare repo and adding it as origin
		const bareDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-bare-'))
		await spawnAndCollect(['git', 'clone', '--bare', gitRoot, bareDir])
		await spawnAndCollect(['git', 'remote', 'add', 'origin', bareDir], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'fetch', 'origin'], { cwd: gitRoot })

		// Add a commit to origin/main that local main doesn't have
		// by pushing a change through a temp clone
		const tempClone = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-clone-'))
		await spawnAndCollect(['git', 'clone', bareDir, tempClone])
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: tempClone,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: tempClone,
		})
		fs.writeFileSync(path.join(tempClone, 'remote-only.txt'), 'from remote')
		await spawnAndCollect(['git', 'add', '.'], { cwd: tempClone })
		await spawnAndCollect(['git', 'commit', '-m', 'remote commit'], {
			cwd: tempClone,
		})
		await spawnAndCollect(['git', 'push'], { cwd: tempClone })

		// Fetch so gitRoot has the updated origin/main
		await spawnAndCollect(['git', 'fetch', 'origin'], { cwd: gitRoot })

		// Create worktree -- should be based on origin/main (which has remote-only.txt)
		const result = await createWorktree(gitRoot, 'feat/from-remote', {
			noInstall: true,
			noFetch: true, // We already fetched manually
		})

		// The worktree should contain the remote-only file
		expect(fs.existsSync(path.join(result.path, 'remote-only.txt'))).toBe(true)

		// Clean up extra temp dirs
		fs.rmSync(bareDir, { recursive: true, force: true })
		fs.rmSync(tempClone, { recursive: true, force: true })
	})

	test('uses existing local branch when it exists', async () => {
		// Create a local branch with a specific file
		await spawnAndCollect(['git', 'checkout', '-b', 'feat/existing-local'], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(gitRoot, 'local-branch.txt'), 'local')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'local branch commit'], {
			cwd: gitRoot,
		})
		await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })

		const result = await createWorktree(gitRoot, 'feat/existing-local', {
			noInstall: true,
			noFetch: true,
		})

		// Should use the existing local branch (which has local-branch.txt)
		expect(fs.existsSync(path.join(result.path, 'local-branch.txt'))).toBe(true)
	})

	test('new worktree creation sets attached to false', async () => {
		const result = await createWorktree(gitRoot, 'feat/fresh-branch', {
			noInstall: true,
			noFetch: true,
		})

		expect(result.attached).toBe(false)
		expect(result.syncResult).toBeUndefined()
	})

	describe('attach-to-existing', () => {
		test('attaches to existing worktree instead of throwing', async () => {
			// First create the worktree
			await createWorktree(gitRoot, 'feat/attach-test', {
				noInstall: true,
				noFetch: true,
			})

			// Call again for the same branch -- should attach instead of throw
			const result = await createWorktree(gitRoot, 'feat/attach-test', {
				noInstall: true,
				noFetch: true,
			})

			expect(result.attached).toBe(true)
			expect(result.syncResult).toBeDefined()
			expect(result.branch).toBe('feat/attach-test')
		})

		test('throws with attach: false option', async () => {
			await createWorktree(gitRoot, 'feat/no-attach', {
				noInstall: true,
				noFetch: true,
			})

			await expect(
				createWorktree(gitRoot, 'feat/no-attach', {
					noInstall: true,
					noFetch: true,
					attach: false,
				}),
			).rejects.toThrow('Worktree already exists')
		})

		test('sync result contains file details when attaching', async () => {
			// Write a config file to copy
			fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=abc')
			const config = {
				directory: '.worktrees',
				copy: ['.env'],
				exclude: ['node_modules'],
				postCreate: null,
				preDelete: null,
				branchTemplate: '{type}/{description}',
			}
			fs.writeFileSync(path.join(gitRoot, CONFIG_FILENAME), JSON.stringify(config))

			// Create the worktree (copies .env)
			const first = await createWorktree(gitRoot, 'feat/sync-detail', {
				noInstall: true,
				noFetch: true,
			})
			expect(first.attached).toBe(false)

			// Change .env in main worktree
			fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=updated')

			// Attach -- should sync the changed .env
			const result = await createWorktree(gitRoot, 'feat/sync-detail', {
				noInstall: true,
				noFetch: true,
			})

			expect(result.attached).toBe(true)
			expect(result.syncResult).toBeDefined()
			expect(result.syncResult!.files.length).toBeGreaterThan(0)
			expect(result.syncResult!.filesCopied).toBeGreaterThanOrEqual(1)

			// Verify the file was actually synced
			const envContent = fs.readFileSync(path.join(result.path, '.env'), 'utf-8')
			expect(envContent).toBe('SECRET=updated')
		})

		test('attach with identical files results in zero copies', async () => {
			fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=same')
			const config = {
				directory: '.worktrees',
				copy: ['.env'],
				exclude: ['node_modules'],
				postCreate: null,
				preDelete: null,
				branchTemplate: '{type}/{description}',
			}
			fs.writeFileSync(path.join(gitRoot, CONFIG_FILENAME), JSON.stringify(config))

			// Create the worktree
			await createWorktree(gitRoot, 'feat/no-change', {
				noInstall: true,
				noFetch: true,
			})

			// Attach without changing anything -- files should be skipped
			const result = await createWorktree(gitRoot, 'feat/no-change', {
				noInstall: true,
				noFetch: true,
			})

			expect(result.attached).toBe(true)
			expect(result.syncResult).toBeDefined()
			expect(result.syncResult!.filesCopied).toBe(0)
			expect(result.syncResult!.filesSkipped).toBeGreaterThanOrEqual(1)
		})
	})
})
