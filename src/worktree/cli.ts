#!/usr/bin/env bun
/**
 * Git worktree CLI.
 *
 * Usage via package bin:
 *   bunx @side-quest/git worktree <command> [...args]
 */

import { parseArgs } from '@side-quest/core/cli'
import { getErrorMessage } from '@side-quest/core/utils'
import { getGitRoot } from '../git/git-root.js'
import { loadOrDetectConfig, writeConfig } from './config.js'
import { createWorktree } from './create.js'
import { checkBeforeDelete, deleteWorktree } from './delete.js'
import { listWorktrees } from './list.js'

function output(data: unknown): void {
	console.log(JSON.stringify(data, null, 2))
}

function fail(message: string): never {
	console.error(JSON.stringify({ error: message }))
	process.exit(1)
}

async function main(): Promise<void> {
	const { command, subcommand, positional, flags } = parseArgs(
		process.argv.slice(2),
	)

	if (command !== 'worktree') {
		fail(
			'Usage: side-quest-git worktree <create|list|delete|check|init> [args]',
		)
	}

	const worktreeCommand = subcommand || ''
	const args = positional

	const gitRoot = await getGitRoot(process.cwd())
	if (!gitRoot) {
		fail('Not in a git repository')
	}

	switch (worktreeCommand) {
		case 'create': {
			const branchName = args[0]
			if (!branchName) {
				fail(
					'Usage: side-quest-git worktree create <branch-name> [--no-install] [--no-fetch]',
				)
			}
			const noInstall = flags['no-install'] === true
			const noFetch = flags['no-fetch'] === true
			const result = await createWorktree(gitRoot, branchName, {
				noInstall,
				noFetch,
			})
			output(result)
			break
		}

		case 'list': {
			const worktrees = await listWorktrees(gitRoot)
			const showAll = flags.all === true
			const filtered = showAll
				? worktrees
				: worktrees.filter((worktree) => !worktree.isMain)
			output(filtered)
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
			output(result)
			break
		}

		case 'check': {
			const branchName = args[0]
			if (!branchName) {
				fail('Usage: side-quest-git worktree check <branch-name>')
			}
			const result = await checkBeforeDelete(gitRoot, branchName)
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

		default:
			fail(
				`Unknown worktree command: ${worktreeCommand || '(none)'}. Available: create, list, delete, check, init`,
			)
	}
}

main().catch((error) => {
	fail(getErrorMessage(error))
})
