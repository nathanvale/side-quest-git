import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { CONFIG_FILENAME } from './config.js'
import { syncWorktree } from './sync.js'

describe('syncWorktree', () => {
	let tmpDir: string
	let gitRoot: string
	let worktreePath: string

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

		// Create initial files
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=old')
		fs.writeFileSync(path.join(gitRoot, 'package.json'), '{}')
		fs.mkdirSync(path.join(gitRoot, '.claude'), { recursive: true })
		fs.writeFileSync(path.join(gitRoot, '.claude', 'CLAUDE.md'), '# Config')
		fs.writeFileSync(path.join(gitRoot, 'README.md'), '# Test')

		// Create .worktrees.json config
		const config = {
			directory: '.worktrees',
			copy: ['.env', '.env.*', '.claude'],
			exclude: ['node_modules', '.git', '.worktrees'],
			postCreate: null,
			preDelete: null,
			branchTemplate: '{type}/{description}',
		}
		fs.writeFileSync(path.join(gitRoot, CONFIG_FILENAME), JSON.stringify(config))

		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], {
			cwd: gitRoot,
		})

		// Create worktree
		worktreePath = path.join(gitRoot, '.worktrees', 'feat-test')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat-test', worktreePath], {
			cwd: gitRoot,
		})

		// Copy initial files to worktree (simulating what create does)
		fs.mkdirSync(path.join(worktreePath, '.claude'), { recursive: true })
		fs.writeFileSync(path.join(worktreePath, '.env'), 'SECRET=old')
		fs.writeFileSync(path.join(worktreePath, '.claude', 'CLAUDE.md'), '# Config')
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('copies changed files', async () => {
		// Change a file in main worktree
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=new')

		const result = await syncWorktree(gitRoot, 'feat-test')
		expect(result.filesCopied).toBeGreaterThanOrEqual(1)
		expect(result.branch).toBe('feat-test')

		// Verify file was actually copied
		const synced = fs.readFileSync(path.join(worktreePath, '.env'), 'utf-8')
		expect(synced).toBe('SECRET=new')
	})

	test('skips identical files', async () => {
		const result = await syncWorktree(gitRoot, 'feat-test')
		// Files are identical, so all should be skipped
		const skippedFiles = result.files.filter((f) => f.action === 'skipped')
		expect(skippedFiles.length).toBeGreaterThan(0)
		expect(result.filesSkipped).toBeGreaterThan(0)
	})

	test('dry run does not copy files', async () => {
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=new')

		const result = await syncWorktree(gitRoot, 'feat-test', { dryRun: true })
		expect(result.dryRun).toBe(true)
		expect(result.filesCopied).toBeGreaterThanOrEqual(1)

		// Verify file was NOT copied
		const content = fs.readFileSync(path.join(worktreePath, '.env'), 'utf-8')
		expect(content).toBe('SECRET=old')
	})

	test('throws for missing worktree', async () => {
		await expect(syncWorktree(gitRoot, 'nonexistent-branch')).rejects.toThrow('Worktree not found')
	})

	test('reports per-file detail', async () => {
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=new')

		const result = await syncWorktree(gitRoot, 'feat-test')
		expect(result.files.length).toBeGreaterThan(0)
		for (const file of result.files) {
			expect(['copied', 'skipped', 'error']).toContain(file.action)
			expect(typeof file.relativePath).toBe('string')
		}
	})

	test('marks new files with "new file" reason', async () => {
		// Add a new .env.local file that doesn't exist in the worktree
		fs.writeFileSync(path.join(gitRoot, '.env.local'), 'LOCAL=true')

		const result = await syncWorktree(gitRoot, 'feat-test')
		const newFile = result.files.find((f) => f.relativePath === '.env.local')
		expect(newFile).toBeDefined()
		expect(newFile?.action).toBe('copied')
		expect(newFile?.reason).toBe('new file')
	})

	test('marks changed files with "content changed" reason', async () => {
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=changed')

		const result = await syncWorktree(gitRoot, 'feat-test')
		const changedFile = result.files.find((f) => f.relativePath === '.env')
		expect(changedFile).toBeDefined()
		expect(changedFile?.action).toBe('copied')
		expect(changedFile?.reason).toBe('content changed')
	})

	test('syncs directory patterns (e.g., .claude)', async () => {
		// Change a file inside a directory pattern
		fs.writeFileSync(path.join(gitRoot, '.claude', 'CLAUDE.md'), '# Updated Config')

		const result = await syncWorktree(gitRoot, 'feat-test')
		const claudeFile = result.files.find((f) => f.relativePath.includes('CLAUDE.md'))
		expect(claudeFile).toBeDefined()
		expect(claudeFile?.action).toBe('copied')

		// Verify the file content was synced
		const synced = fs.readFileSync(path.join(worktreePath, '.claude', 'CLAUDE.md'), 'utf-8')
		expect(synced).toBe('# Updated Config')
	})

	test('handles branch names with slashes', async () => {
		// Create a worktree with a slash-containing branch name
		const slashPath = path.join(gitRoot, '.worktrees', 'feat-slash-test')
		await spawnAndCollect(['git', 'worktree', 'add', '-b', 'feat/slash-test', slashPath], {
			cwd: gitRoot,
		})
		fs.writeFileSync(path.join(slashPath, '.env'), 'SECRET=old')

		// Change the source file
		fs.writeFileSync(path.join(gitRoot, '.env'), 'SECRET=new')

		const result = await syncWorktree(gitRoot, 'feat/slash-test')
		expect(result.branch).toBe('feat/slash-test')
		expect(result.filesCopied).toBeGreaterThanOrEqual(1)
	})
})
