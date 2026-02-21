import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { CONFIG_FILENAME } from './config.js'

const CLI_PATH = path.join(import.meta.dir, 'cli.ts')

describe('worktree CLI', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))

		await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: tmpDir,
		})
		fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test')
		fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=abc')
		await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], {
			cwd: tmpDir,
		})

		// Write config for deterministic tests
		fs.writeFileSync(
			path.join(tmpDir, CONFIG_FILENAME),
			JSON.stringify({
				directory: '.worktrees',
				copy: ['.env'],
				exclude: ['node_modules'],
				postCreate: null,
				preDelete: null,
				branchTemplate: '{type}/{description}',
			}),
		)
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('create: creates a worktree and outputs JSON', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', 'feat/cli-test', '--no-install', '--no-fetch'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.branch).toBe('feat/cli-test')
		expect(parsed.filesCopied).toBe(1)
	})

	test('list: lists worktrees as JSON with health metadata', async () => {
		// Create a worktree first
		await spawnAndCollect(
			[
				'bun',
				'run',
				CLI_PATH,
				'worktree',
				'create',
				'feat/list-test',
				'--no-install',
				'--no-fetch',
			],
			{ cwd: tmpDir },
		)

		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'list'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		// Output is now { worktrees, health } -- not a bare array
		expect(Array.isArray(parsed.worktrees)).toBe(true)
		// Without --all, main worktree is excluded
		expect(parsed.worktrees).toHaveLength(1)
		expect(parsed.worktrees[0].branch).toBe('feat/list-test')
		// Health metadata is present
		expect(parsed.health).toBeDefined()
		expect(typeof parsed.health.total).toBe('number')
		expect(typeof parsed.health.degradedCount).toBe('number')
		expect(typeof parsed.health.fatalCount).toBe('number')
		expect(typeof parsed.health.allFailed).toBe('boolean')
	})

	test('list --all: includes main worktree', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'list', '--all'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.worktrees.some((w: { isMain: boolean }) => w.isMain)).toBe(true)
	})

	test('delete: removes a worktree', async () => {
		await spawnAndCollect(
			[
				'bun',
				'run',
				CLI_PATH,
				'worktree',
				'create',
				'feat/delete-test',
				'--no-install',
				'--no-fetch',
			],
			{ cwd: tmpDir },
		)

		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'delete', 'feat/delete-test'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.branch).toBe('feat/delete-test')
	})

	test('check: shows pre-deletion status', async () => {
		await spawnAndCollect(
			[
				'bun',
				'run',
				CLI_PATH,
				'worktree',
				'create',
				'feat/check-test',
				'--no-install',
				'--no-fetch',
			],
			{ cwd: tmpDir },
		)

		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'check', 'feat/check-test'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.exists).toBe(true)
		expect(parsed.dirty).toBe(false)
	})

	test('init: creates .worktrees.json', async () => {
		// Remove the config first
		fs.unlinkSync(path.join(tmpDir, CONFIG_FILENAME))

		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'init'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.message).toContain('auto-detected')
		expect(fs.existsSync(path.join(tmpDir, CONFIG_FILENAME))).toBe(true)
	})

	test('unknown command: exits with error', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'bogus'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).not.toBe(0)
	})

	test('create without branch: exits with error', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'create'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).not.toBe(0)
	})

	test('create with bare --base: exits with error', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', 'feat/base-missing', '--base'],
			{
				cwd: tmpDir,
			},
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('Invalid --base value')
	})

	test('status --watch rejects invalid interval values', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'status', '--watch', '--interval', 'abc'],
			{
				cwd: tmpDir,
			},
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('Invalid --interval value')
	})

	test('list --timeout: accepts valid millisecond value and succeeds', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--timeout', '30000'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.worktrees)).toBe(true)
	})

	test('list --timeout: rejects non-numeric value', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--timeout', 'abc'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('Invalid --timeout value')
	})

	test('list --timeout: rejects zero value', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--timeout', '0'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('Invalid --timeout value')
	})

	test('check --timeout: accepts valid millisecond value and succeeds', async () => {
		await spawnAndCollect(
			[
				'bun',
				'run',
				CLI_PATH,
				'worktree',
				'create',
				'feat/timeout-check',
				'--no-install',
				'--no-fetch',
			],
			{ cwd: tmpDir },
		)

		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'check', 'feat/timeout-check', '--timeout', '30000'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.exists).toBe(true)
	})

	test('check --timeout: rejects non-numeric value', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'check', 'feat/any', '--timeout', 'abc'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('Invalid --timeout value')
	})

	test('orphans --timeout: accepts valid millisecond value and succeeds', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'orphans', '--timeout', '30000'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.orphans)).toBe(true)
		expect(parsed.health).toBeDefined()
	})

	test('clean --timeout: accepts valid millisecond value and succeeds', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'clean', '--dry-run', '--timeout', '30000'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.dryRun).toBe(true)
	})

	test('list --include-orphans: includes orphanHealth in JSON output', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--include-orphans'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.worktrees)).toBe(true)
		expect(Array.isArray(parsed.orphans)).toBe(true)
		expect(parsed.health).toBeDefined()
		expect(parsed.orphanHealth).toBeDefined()
		expect(typeof parsed.orphanHealth.total).toBe('number')
		expect(typeof parsed.orphanHealth.allFailed).toBe('boolean')
	})

	test('list: health.allFailed is false when enrichments succeed', async () => {
		// A healthy repo: main worktree enriches successfully, allFailed must be false.
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'list', '--all'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.health.allFailed).toBe(false)
		// fatalCount must be 0 for a healthy repo
		expect(parsed.health.fatalCount).toBe(0)
	})

	test('orphans: health.allFailed is false when no orphans exist', async () => {
		// An empty orphan list is not a systemic failure -- allFailed should be false.
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'orphans'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(parsed.health.total).toBe(0)
		expect(parsed.health.allFailed).toBe(false)
	})

	test('list: exits 0 and flushes JSON output on success (#48)', async () => {
		// Verify that list output is fully flushed and exit code is 0 on success.
		// This regression test ensures process.exitCode = 1; return pattern does
		// not prematurely truncate output when allFailed is false.
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'list', '--all'], {
			cwd: tmpDir,
		})

		// Exit code must be 0
		expect(result.exitCode).toBe(0)
		// stdout must be valid, non-empty JSON
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.worktrees)).toBe(true)
		// Critically: the output must be fully flushed (not truncated)
		expect(parsed.health).toBeDefined()
	})

	test('orphans: exits 0 and flushes JSON output on success (#48)', async () => {
		// Mirror of the list test for the orphans command, which also uses
		// process.exitCode = 1; return when allFailed is true.
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'orphans'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.orphans)).toBe(true)
		expect(parsed.health).toBeDefined()
	})

	test('list --shallow-ok: flag is accepted and command succeeds (#51)', async () => {
		// Verify that the --shallow-ok flag is wired up and does not cause an error.
		// This ensures the flag passes through the CLI arg parsing and reaches
		// listWorktrees without being rejected as an unknown option.
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--shallow-ok'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.worktrees)).toBe(true)
	})

	test('recover: lists backup refs as JSON array when no backups exist (#51)', async () => {
		// Verify the recover subcommand is wired up and returns a JSON array.
		// With no prior deletions in the test repo there are no backup refs,
		// so the output is an empty array -- but the command must exit 0.
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'recover'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed)).toBe(true)
	})

	test('recover --cleanup: runs cleanup and returns cleaned/count fields (#51)', async () => {
		// Verify the recover --cleanup subcommand is wired up and returns the
		// expected shape. With no old backup refs the cleaned array is empty.
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'recover', '--cleanup'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const parsed = JSON.parse(result.stdout)
		expect(Array.isArray(parsed.cleaned)).toBe(true)
		expect(typeof parsed.count).toBe('number')
	})
})
