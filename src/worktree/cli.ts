#!/usr/bin/env bun
/**
 * Git worktree and event bus CLI.
 *
 * Usage via package bin:
 *   bunx @side-quest/git worktree <command> [...args]
 *   bunx @side-quest/git events <start|tail> [...args]
 */

import path from 'node:path'
import { parseArgs } from '@side-quest/core/cli'
import { getErrorMessage } from '@side-quest/core/utils'
import { getRepoCacheKey } from '../events/cache-key.js'
import { emitCliEvent } from '../events/emit.js'
import { getMainRoot } from '../git/git-root.js'
import { loadOrDetectConfig, writeConfig } from './config.js'
import { createWorktree } from './create.js'
import { checkBeforeDelete, deleteWorktree } from './delete.js'
import { listWorktrees } from './list.js'
import { cleanupStaleTempDirs } from './merge-status.js'

function output(data: unknown): void {
	console.log(JSON.stringify(data, null, 2))
}

function fail(message: string): never {
	console.error(JSON.stringify({ error: message }))
	process.exit(1)
}

async function main(): Promise<void> {
	// Best-effort cleanup of any temp dirs this process created.
	// The finally block in createIsolatedObjectEnv handles the normal path;
	// this handler catches SIGTERM (e.g. container shutdown, `kill <pid>`).
	// Exit code 143 = 128 + 15 (SIGTERM), the POSIX convention.
	process.on('SIGTERM', () => {
		cleanupStaleTempDirs()
		process.exit(143)
	})

	const { command, subcommand, positional, flags } = parseArgs(
		process.argv.slice(2),
	)

	// Handle the events top-level command
	if (command === 'events') {
		const gitRoot = await getMainRoot(process.cwd())
		if (!gitRoot) {
			fail('Not in a git repository')
		}
		await handleEventsCommand(subcommand || '', positional, flags, gitRoot)
		return
	}

	if (command !== 'worktree') {
		fail('Usage: side-quest-git <worktree|events> <command> [args]')
	}

	const worktreeCommand = subcommand || ''
	const args = positional

	const gitRoot = await getMainRoot(process.cwd())
	if (!gitRoot) {
		fail('Not in a git repository')
	}

	switch (worktreeCommand) {
		case 'create': {
			const branchName = args[0]
			if (!branchName) {
				fail(
					'Usage: side-quest-git worktree create <branch-name> [--no-install] [--no-fetch] [--no-attach] [--base <ref>]',
				)
			}
			const noInstall = flags['no-install'] === true
			const noFetch = flags['no-fetch'] === true
			const noAttach = flags['no-attach'] === true
			const base = parseBaseRef(flags.base)
			const result = await createWorktree(gitRoot, branchName, {
				noInstall,
				noFetch,
				attach: !noAttach,
				base,
			})
			void emitCliEvent(
				result.attached ? 'worktree.attached' : 'worktree.created',
				result,
				{ repo: path.basename(gitRoot), gitRoot, source: 'cli' },
			)
			output(result)
			break
		}

		case 'list': {
			const showAll = flags.all === true
			const includeOrphans = flags['include-orphans'] === true
			const shallowOk = flags['shallow-ok'] === true
			const detectionTimeout = parseDetectionTimeoutMs(flags.timeout)
			const worktrees = await listWorktrees(gitRoot, {
				detectionTimeout,
				shallowOk,
			})
			const filtered = showAll
				? worktrees
				: worktrees.filter((worktree) => !worktree.isMain)

			if (includeOrphans) {
				const { listOrphanBranches } = await import('./orphans.js')
				const orphans = await listOrphanBranches(gitRoot, {
					detectionTimeout,
					shallowOk,
				})
				output({ worktrees: filtered, orphans })
			} else {
				output(filtered)
			}
			break
		}

		case 'delete': {
			const branchName = args[0]
			if (!branchName) {
				fail(
					'Usage: side-quest-git worktree delete <branch-name> [--force] [--delete-branch]',
				)
			}

			const force = flags.force === true
			const deleteBranch = flags['delete-branch'] === true
			const result = await deleteWorktree(gitRoot, branchName, {
				force,
				deleteBranch,
			})
			void emitCliEvent('worktree.deleted', result, {
				repo: path.basename(gitRoot),
				gitRoot,
				source: 'cli',
			})
			output(result)
			break
		}

		case 'check': {
			const branchName = args[0]
			if (!branchName) {
				fail(
					'Usage: side-quest-git worktree check <branch-name> [--timeout <ms>] [--shallow-ok]',
				)
			}
			const shallowOk = flags['shallow-ok'] === true
			const detectionTimeout = parseDetectionTimeoutMs(flags.timeout)
			const result = await checkBeforeDelete(gitRoot, branchName, {
				detectionTimeout,
				shallowOk,
			})
			output(result)
			break
		}

		case 'init': {
			const { config, autoDetected } = loadOrDetectConfig(gitRoot)
			if (!autoDetected) {
				output({
					message: '.worktrees.json already exists',
					config,
				})
			} else {
				writeConfig(gitRoot, config)
				output({
					message: 'Created .worktrees.json with auto-detected settings',
					config,
				})
			}
			break
		}

		case 'install': {
			const targetPath = args[0]
			if (!targetPath) {
				fail('Usage: side-quest-git worktree install <path> [--force]')
			}
			const force = flags.force === true
			const { runInstall } = await import('./install.js')
			const result = await runInstall(
				path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath),
				{ force },
			)
			void emitCliEvent('worktree.installed', result, {
				repo: path.basename(gitRoot),
				gitRoot,
				source: 'cli',
			})
			output(result)
			break
		}

		case 'sync': {
			const branchOrAll = args[0]
			const dryRun = flags['dry-run'] === true
			const all = flags.all === true || branchOrAll === '--all'

			if (all) {
				const { syncAllWorktrees } = await import('./sync.js')
				const results = await syncAllWorktrees(gitRoot, { dryRun })
				void emitCliEvent('worktree.synced', results, {
					repo: path.basename(gitRoot),
					gitRoot,
					source: 'cli',
				})
				output(results)
			} else {
				if (!branchOrAll) {
					fail(
						'Usage: side-quest-git worktree sync <branch> [--dry-run] or worktree sync --all',
					)
				}
				const { syncWorktree } = await import('./sync.js')
				const result = await syncWorktree(gitRoot, branchOrAll, {
					dryRun,
				})
				void emitCliEvent('worktree.synced', result, {
					repo: path.basename(gitRoot),
					gitRoot,
					source: 'cli',
				})
				output(result)
			}
			break
		}

		case 'status': {
			const prFlag = flags.pr === true
			const watchFlag = flags.watch === true

			if (watchFlag) {
				const interval = parseWatchIntervalMs(flags.interval)
				const { watchWorktreeStatus } = await import('./watch.js')
				await watchWorktreeStatus(gitRoot, {
					interval,
					includePr: prFlag,
				})
			} else {
				const { getWorktreeStatus } = await import('./status.js')
				const statuses = await getWorktreeStatus(gitRoot, {
					includePr: prFlag,
				})
				output(statuses)
			}
			break
		}

		case 'orphans': {
			const shallowOk = flags['shallow-ok'] === true
			const detectionTimeout = parseDetectionTimeoutMs(flags.timeout)
			const { listOrphanBranches } = await import('./orphans.js')
			const orphans = await listOrphanBranches(gitRoot, {
				detectionTimeout,
				shallowOk,
			})
			output(orphans)
			break
		}

		case 'clean': {
			const dryRun = flags['dry-run'] === true
			const force = flags.force === true
			const deleteBranches = flags['delete-branches'] === true
			const includeOrphans = flags['include-orphans'] === true
			const shallowOk = flags['shallow-ok'] === true
			const detectionTimeout = parseDetectionTimeoutMs(flags.timeout)

			if (force && !dryRun) {
				console.error(
					JSON.stringify({
						warning:
							'Force mode: will delete dirty and unmerged worktrees (except main)',
					}),
				)
			}

			const { cleanWorktrees } = await import('./clean.js')
			const result = await cleanWorktrees(gitRoot, {
				force,
				dryRun,
				deleteBranches,
				includeOrphans,
				shallowOk,
				detectionTimeout,
			})
			void emitCliEvent('worktree.cleaned', result, {
				repo: path.basename(gitRoot),
				gitRoot,
				source: 'cli',
			})
			output(result)
			break
		}

		case 'recover': {
			const { cleanupBackupRefs, listBackupRefs, restoreBackupRef } =
				await import('./backup.js')

			const cleanup = flags.cleanup === true
			const maxAgeDays = parseMaxAgeDays(flags['max-age'])

			if (cleanup) {
				// `worktree recover --cleanup [--max-age <days>]`
				const deleted = await cleanupBackupRefs(gitRoot, maxAgeDays)
				output({ cleaned: deleted, count: deleted.length })
				break
			}

			const targetBranch = args[0]
			if (targetBranch) {
				// `worktree recover <branch>` -- restore from backup
				await restoreBackupRef(gitRoot, targetBranch)
				output({ restored: targetBranch })
			} else {
				// `worktree recover` -- list all backup refs
				const refs = await listBackupRefs(gitRoot)
				output(refs)
			}
			break
		}

		default:
			fail(
				`Unknown worktree command: ${worktreeCommand || '(none)'}. Available: create, list, delete, check, init, install, sync, status, orphans, clean, recover`,
			)
	}
}

/**
 * Handle the `events` top-level command.
 *
 * Why: The event bus server needs CLI subcommands for starting
 * the server and tailing the event stream in real-time.
 *
 * Subcommands:
 *   start - Start the event bus server (foreground)
 *   tail  - Connect to a running server and stream events
 */
async function handleEventsCommand(
	eventsSubcommand: string,
	_args: string[],
	flags: Record<string, string | boolean | (string | boolean)[]>,
	gitRoot: string,
): Promise<void> {
	const repoDisplayName = path.basename(gitRoot)
	const repoCacheKey = getRepoCacheKey(gitRoot)

	switch (eventsSubcommand) {
		case 'start': {
			const port = parsePort(flags.port)
			const { startEventServer } = await import('../events/server.js')
			const server = startEventServer({
				port,
				repoName: repoDisplayName,
				cacheKey: repoCacheKey,
				gitRoot,
			})
			output({ status: 'started', port: server.port, pid: process.pid })
			// Keep the process alive until interrupted
			process.on('SIGINT', () => {
				server.stop()
				process.exit(0)
			})
			process.on('SIGTERM', () => {
				server.stop()
				process.exit(0)
			})
			// Block indefinitely
			await new Promise(() => {})
			break
		}

		case 'tail': {
			const typeRaw = flags.type
			const typeFilter = typeof typeRaw === 'string' ? typeRaw : undefined
			const { readEventServerPort } = await import('../events/server.js')
			const port = readEventServerPort(repoCacheKey)
			if (!port) {
				fail(
					`No running event server found for repo "${repoDisplayName}". Run: side-quest-git events start`,
				)
			}
			const { connectEventClient } = await import('../events/client.js')
			connectEventClient({
				port,
				typeFilter,
				onEvent: (event) => {
					console.log(JSON.stringify(event))
				},
				onError: (error) => {
					console.error(JSON.stringify({ error: error.message }))
				},
			})
			// Keep the process alive
			process.on('SIGINT', () => process.exit(0))
			await new Promise(() => {})
			break
		}

		default:
			fail(
				`Unknown events command: ${eventsSubcommand || '(none)'}. Available: start, tail`,
			)
	}
}

/**
 * Parse and validate the `--port` flag for the event server.
 *
 * Why: NaN or out-of-range values would silently break Bun.serve().
 */
function parsePort(
	portFlag: string | boolean | (string | boolean)[] | undefined,
): number {
	if (portFlag === undefined) return 7483
	if (typeof portFlag !== 'string') {
		fail('Invalid --port value: expected a number between 1 and 65535')
	}
	const port = Number.parseInt(portFlag, 10)
	if (!Number.isFinite(port) || port < 1 || port > 65535) {
		fail('Invalid --port value: expected a number between 1 and 65535')
	}
	return port
}

/**
 * Parse and validate the `--base` flag used by `worktree create`.
 *
 * Why: A bare `--base` is parsed as `true` and would otherwise be silently
 * ignored, causing branch creation from an unexpected default base.
 */
function parseBaseRef(
	baseFlag: string | boolean | (string | boolean)[] | undefined,
): string | undefined {
	if (baseFlag === undefined) {
		return undefined
	}
	if (typeof baseFlag !== 'string' || baseFlag.trim().length === 0) {
		fail('Invalid --base value: expected a branch, tag, or commit ref')
	}
	return baseFlag
}

/**
 * Parse and validate the `--interval` flag for watch mode.
 *
 * Why: Invalid or non-positive values can cause a tight polling loop.
 */
function parseWatchIntervalMs(
	intervalFlag: string | boolean | (string | boolean)[] | undefined,
): number | undefined {
	if (intervalFlag === undefined) {
		return undefined
	}
	if (typeof intervalFlag !== 'string') {
		fail('Invalid --interval value: expected a positive integer in seconds')
	}

	if (!/^\d+$/.test(intervalFlag)) {
		fail('Invalid --interval value: expected a positive integer in seconds')
	}

	const intervalSeconds = Number.parseInt(intervalFlag, 10)
	if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		fail('Invalid --interval value: expected a positive integer in seconds')
	}

	return intervalSeconds * 1000
}

/**
 * Parse and validate the `--timeout` flag for detection-aware commands.
 *
 * Why: Invalid or non-positive values would either crash or produce a
 * near-zero timeout that always expires, making detection useless.
 * Returns undefined when the flag is absent so callers fall back to the
 * env var or the 5000ms default in detectMergeStatus.
 *
 * @param timeoutFlag - Raw flag value from parseArgs
 * @returns Timeout in milliseconds, or undefined if the flag was not set
 */
function parseDetectionTimeoutMs(
	timeoutFlag: string | boolean | (string | boolean)[] | undefined,
): number | undefined {
	if (timeoutFlag === undefined) {
		return undefined
	}
	if (typeof timeoutFlag !== 'string') {
		fail('Invalid --timeout value: expected a positive integer in milliseconds')
	}
	if (!/^\d+$/.test(timeoutFlag)) {
		fail('Invalid --timeout value: expected a positive integer in milliseconds')
	}
	const ms = Number.parseInt(timeoutFlag, 10)
	if (!Number.isFinite(ms) || ms <= 0) {
		fail('Invalid --timeout value: expected a positive integer in milliseconds')
	}
	return ms
}

/**
 * Parse and validate the `--max-age` flag for `worktree recover --cleanup`.
 *
 * Why: A non-positive or non-numeric value would silently prune nothing
 * or everything, which would be very surprising.
 */
function parseMaxAgeDays(
	maxAgeFlag: string | boolean | (string | boolean)[] | undefined,
): number {
	if (maxAgeFlag === undefined) return 30
	if (typeof maxAgeFlag !== 'string') {
		fail(
			'Invalid --max-age value: expected a positive integer (number of days)',
		)
	}
	const days = Number.parseInt(maxAgeFlag, 10)
	if (!Number.isFinite(days) || days < 1) {
		fail(
			'Invalid --max-age value: expected a positive integer (number of days)',
		)
	}
	return days
}

main().catch((error) => {
	fail(getErrorMessage(error))
})
