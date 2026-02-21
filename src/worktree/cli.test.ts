import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { CONFIG_FILENAME } from './config.js'

const CLI_PATH = path.join(import.meta.dir, 'cli/index.ts')

interface SuccessEnvelope<T> {
	readonly status: 'ok'
	readonly data: T
}

interface ErrorEnvelope {
	readonly status: 'error'
	readonly error: {
		readonly code: string
		readonly name: string
		readonly message: string
	}
}

function parseSuccess<T>(stdout: string): T {
	const parsed = JSON.parse(stdout) as SuccessEnvelope<T>
	expect(parsed.status).toBe('ok')
	return parsed.data
}

function parseError(stderr: string): ErrorEnvelope['error'] {
	const parsed = JSON.parse(stderr) as ErrorEnvelope
	expect(parsed.status).toBe('error')
	return parsed.error
}

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

	test('create: creates a worktree and returns success envelope', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', 'feat/cli-test', '--no-install', '--no-fetch'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const data = parseSuccess<{ branch: string; filesCopied: number }>(result.stdout)
		expect(data.branch).toBe('feat/cli-test')
		expect(data.filesCopied).toBe(1)
	})

	test('list: lists worktrees with health metadata in envelope', async () => {
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
		const data = parseSuccess<{
			worktrees: Array<{ branch: string }>
			health: { total: number; degradedCount: number; fatalCount: number; allFailed: boolean }
		}>(result.stdout)
		expect(Array.isArray(data.worktrees)).toBe(true)
		expect(data.worktrees).toHaveLength(1)
		expect(data.worktrees[0].branch).toBe('feat/list-test')
		expect(typeof data.health.total).toBe('number')
		expect(typeof data.health.degradedCount).toBe('number')
		expect(typeof data.health.fatalCount).toBe('number')
		expect(typeof data.health.allFailed).toBe('boolean')
	})

	test('list --all: includes main worktree', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'list', '--all'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const data = parseSuccess<{ worktrees: Array<{ isMain: boolean }> }>(result.stdout)
		expect(data.worktrees.some((w) => w.isMain)).toBe(true)
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
		const data = parseSuccess<{ branch: string }>(result.stdout)
		expect(data.branch).toBe('feat/delete-test')
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
		const data = parseSuccess<{ exists: boolean; dirty: boolean }>(result.stdout)
		expect(data.exists).toBe(true)
		expect(data.dirty).toBe(false)
	})

	test('init: creates .worktrees.json', async () => {
		fs.unlinkSync(path.join(tmpDir, CONFIG_FILENAME))

		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'init'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(0)
		const data = parseSuccess<{ message: string }>(result.stdout)
		expect(data.message).toContain('auto-detected')
		expect(fs.existsSync(path.join(tmpDir, CONFIG_FILENAME))).toBe(true)
	})

	test('unknown command: exits 2 with structured usage error', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'bogus'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.code).toBe('E_USAGE')
		expect(error.message).toContain('Unknown worktree command')
	})

	test('create without branch: exits 2 with usage error envelope', async () => {
		const result = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'create'], {
			cwd: tmpDir,
		})

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.code).toBe('E_USAGE')
	})

	test('create with bare --base: exits with usage error', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', 'feat/base-missing', '--base'],
			{
				cwd: tmpDir,
			},
		)

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.message).toContain('Invalid --base value')
	})

	test('status --watch rejects invalid interval values', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'status', '--watch', '--interval', 'abc'],
			{
				cwd: tmpDir,
			},
		)

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.message).toContain('Invalid --interval value')
	})

	test('list --timeout accepts valid values', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--timeout', '30000'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const data = parseSuccess<{ worktrees: unknown[] }>(result.stdout)
		expect(Array.isArray(data.worktrees)).toBe(true)
	})

	test('list --timeout rejects non-numeric values', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--timeout', 'abc'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.message).toContain('Invalid --timeout value')
	})

	test('list --include-orphans includes orphan health output', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--include-orphans'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(0)
		const data = parseSuccess<{
			worktrees: unknown[]
			orphans: unknown[]
			health: unknown
			orphanHealth: { total: number; allFailed: boolean }
		}>(result.stdout)
		expect(Array.isArray(data.worktrees)).toBe(true)
		expect(Array.isArray(data.orphans)).toBe(true)
		expect(data.health).toBeDefined()
		expect(typeof data.orphanHealth.total).toBe('number')
		expect(typeof data.orphanHealth.allFailed).toBe('boolean')
	})

	test('recover: list and cleanup output shapes are preserved', async () => {
		const listResult = await spawnAndCollect(['bun', 'run', CLI_PATH, 'worktree', 'recover'], {
			cwd: tmpDir,
		})
		expect(listResult.exitCode).toBe(0)
		const listData = parseSuccess<unknown[]>(listResult.stdout)
		expect(Array.isArray(listData)).toBe(true)

		const cleanupResult = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'recover', '--cleanup'],
			{ cwd: tmpDir },
		)
		expect(cleanupResult.exitCode).toBe(0)
		const cleanupData = parseSuccess<{ cleaned: unknown[]; count: number }>(cleanupResult.stdout)
		expect(Array.isArray(cleanupData.cleaned)).toBe(true)
		expect(typeof cleanupData.count).toBe('number')
	})

	test('--help returns generated usage data', async () => {
		const topLevel = await spawnAndCollect(['bun', 'run', CLI_PATH, '--help'], {
			cwd: tmpDir,
		})
		expect(topLevel.exitCode).toBe(0)
		const topData = parseSuccess<{ help: string }>(topLevel.stdout)
		expect(topData.help).toContain('Usage: side-quest-git')

		const commandHelp = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', '--help'],
			{ cwd: tmpDir },
		)
		expect(commandHelp.exitCode).toBe(0)
		const commandData = parseSuccess<{ help: string }>(commandHelp.stdout)
		expect(commandData.help).toContain('worktree create')
	})

	test('unknown flags are rejected with usage errors', async () => {
		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'create', 'feat/flag-test', '--bogus'],
			{ cwd: tmpDir },
		)

		expect(result.exitCode).toBe(2)
		const error = parseError(result.stderr)
		expect(error.code).toBe('E_USAGE')
		expect(error.message).toContain('Unknown flag --bogus')
	})

	test('--fields projects list output for token-efficient consumption', async () => {
		await spawnAndCollect(
			[
				'bun',
				'run',
				CLI_PATH,
				'worktree',
				'create',
				'feat/fields-test',
				'--no-install',
				'--no-fetch',
			],
			{ cwd: tmpDir },
		)

		const result = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--all', '--fields', 'branch,merged'],
			{ cwd: tmpDir },
		)
		expect(result.exitCode).toBe(0)

		const data = parseSuccess<Array<{ branch?: string; merged?: boolean }>>(result.stdout)
		expect(Array.isArray(data)).toBe(true)
		expect(data.some((entry) => 'branch' in entry)).toBe(true)
	})

	test('--jsonl emits compact envelopes and --quiet suppresses stdout', async () => {
		const jsonlResult = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--jsonl'],
			{ cwd: tmpDir },
		)
		expect(jsonlResult.exitCode).toBe(0)
		expect(jsonlResult.stdout.trim().split('\n').length).toBe(1)
		const parsed = JSON.parse(jsonlResult.stdout) as SuccessEnvelope<unknown>
		expect(parsed.status).toBe('ok')

		const quietResult = await spawnAndCollect(
			['bun', 'run', CLI_PATH, 'worktree', 'list', '--quiet'],
			{ cwd: tmpDir },
		)
		expect(quietResult.exitCode).toBe(0)
		expect(quietResult.stdout).toBe('')
	})
})
