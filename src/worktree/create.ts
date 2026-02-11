/**
 * Worktree creation logic.
 *
 * Creates a git worktree, copies configured files from the main worktree,
 * and optionally runs postCreate command (for dependency installation).
 */

import path from 'node:path'
import { pathExistsSync } from '@side-quest/core/fs'
import { shellExec, spawnAndCollect } from '@side-quest/core/spawn'
import { loadOrDetectConfig } from './config.js'
import { copyWorktreeFiles } from './copy-files.js'
import type { CreateResult } from './types.js'
import { validateShellCommand } from './validate.js'

/**
 * Create a new git worktree.
 */
export async function createWorktree(
	gitRoot: string,
	branchName: string,
	options: { noInstall?: boolean; noFetch?: boolean; attach?: boolean } = {},
): Promise<CreateResult> {
	const { config, autoDetected } = loadOrDetectConfig(gitRoot)

	const sanitizedBranch = branchName.replace(/\//g, '-')
	const worktreePath = path.join(gitRoot, config.directory, sanitizedBranch)

	if (pathExistsSync(worktreePath)) {
		if (options.attach === false) {
			throw new Error(`Worktree already exists at ${worktreePath}`)
		}
		// Attach-to-existing: sync files instead of creating
		const { syncWorktree } = await import('./sync.js')
		const syncResult = await syncWorktree(gitRoot, branchName, {
			dryRun: false,
		})
		return {
			branch: branchName,
			path: worktreePath,
			filesCopied: syncResult.filesCopied,
			postCreateOutput: null,
			configAutoDetected: autoDetected,
			attached: true,
			syncResult,
		}
	}

	if (!options.noFetch) {
		await spawnAndCollect(['git', 'fetch', '--prune', '--quiet'], {
			cwd: gitRoot,
		})
	}

	const branchExists = await checkBranchExists(gitRoot, branchName)
	const remoteBranchExists = await checkRemoteBranchExists(gitRoot, branchName)

	let addArgs: string[]
	if (branchExists) {
		addArgs = ['git', 'worktree', 'add', worktreePath, branchName]
	} else if (remoteBranchExists) {
		addArgs = [
			'git',
			'worktree',
			'add',
			'-b',
			branchName,
			worktreePath,
			`origin/${branchName}`,
		]
	} else {
		const defaultBase = await getRemoteDefaultBranch(gitRoot)
		addArgs = [
			'git',
			'worktree',
			'add',
			'-b',
			branchName,
			worktreePath,
			defaultBase,
		]
	}

	const addResult = await spawnAndCollect(addArgs, { cwd: gitRoot })
	if (addResult.exitCode !== 0) {
		throw new Error(`Failed to create worktree: ${addResult.stderr.trim()}`)
	}

	const filesCopied = copyWorktreeFiles(
		gitRoot,
		worktreePath,
		config.copy,
		config.exclude,
	)

	let postCreateOutput: string | null = null
	if (config.postCreate && !options.noInstall) {
		postCreateOutput = await runPostCreate(config.postCreate, worktreePath)
	}

	return {
		branch: branchName,
		path: worktreePath,
		filesCopied,
		postCreateOutput,
		configAutoDetected: autoDetected,
		attached: false,
	}
}

async function checkBranchExists(
	gitRoot: string,
	branchName: string,
): Promise<boolean> {
	const result = await spawnAndCollect(
		['git', 'show-ref', '--verify', `refs/heads/${branchName}`],
		{ cwd: gitRoot },
	)
	return result.exitCode === 0
}

async function checkRemoteBranchExists(
	gitRoot: string,
	branchName: string,
): Promise<boolean> {
	const result = await spawnAndCollect(
		['git', 'show-ref', '--verify', `refs/remotes/origin/${branchName}`],
		{ cwd: gitRoot },
	)
	return result.exitCode === 0
}

async function getRemoteDefaultBranch(gitRoot: string): Promise<string> {
	const mainResult = await spawnAndCollect(
		['git', 'show-ref', '--verify', 'refs/remotes/origin/main'],
		{ cwd: gitRoot },
	)
	if (mainResult.exitCode === 0) {
		return 'origin/main'
	}

	const masterResult = await spawnAndCollect(
		['git', 'show-ref', '--verify', 'refs/remotes/origin/master'],
		{ cwd: gitRoot },
	)
	if (masterResult.exitCode === 0) {
		return 'origin/master'
	}

	return 'HEAD'
}

async function runPostCreate(command: string, cwd: string): Promise<string> {
	validateShellCommand(command)
	const result = await shellExec(command, { cwd, throws: false })
	if (result.exitCode !== 0) {
		throw new Error(
			`postCreate command failed (${command}): ${result.stderr.trim()}`,
		)
	}
	return result.stdout.trim()
}
