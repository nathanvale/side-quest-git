#!/usr/bin/env bun

import { parseArgs } from '@side-quest/core/cli'
import { getMainRoot } from '../../git/git-root.js'
import { cleanupStaleTempDirs } from '../merge-status.js'
import {
	type CommandGroup,
	getCommandDef,
	getCommandsForGroup,
	isCommandGroup,
} from './commands.js'
import { CliError, toCliError } from './errors.js'
import { EXIT_SIGTERM } from './exit-codes.js'
import { handleEventsStart } from './handlers/events-start.js'
import { handleEventsTail } from './handlers/events-tail.js'
import type { CommandHandler } from './handlers/types.js'
import { handleWorktreeCheck } from './handlers/worktree-check.js'
import { handleWorktreeClean } from './handlers/worktree-clean.js'
import { handleWorktreeCreate } from './handlers/worktree-create.js'
import { handleWorktreeDelete } from './handlers/worktree-delete.js'
import { handleWorktreeInit } from './handlers/worktree-init.js'
import { handleWorktreeInstall } from './handlers/worktree-install.js'
import { handleWorktreeList } from './handlers/worktree-list.js'
import { handleWorktreeOrphans } from './handlers/worktree-orphans.js'
import { handleWorktreeRecover } from './handlers/worktree-recover.js'
import { handleWorktreeStatus } from './handlers/worktree-status.js'
import { handleWorktreeSync } from './handlers/worktree-sync.js'
import { generateHelpText } from './help.js'
import { type OutputOptions, writeError, writeSuccess } from './output.js'
import { parseGlobalCliOptions } from './parsers.js'
import { validateFlags } from './validate-flags.js'

const WORKTREE_HANDLERS: Readonly<Record<string, CommandHandler>> = {
	create: handleWorktreeCreate,
	list: handleWorktreeList,
	delete: handleWorktreeDelete,
	check: handleWorktreeCheck,
	init: handleWorktreeInit,
	install: handleWorktreeInstall,
	sync: handleWorktreeSync,
	status: handleWorktreeStatus,
	orphans: handleWorktreeOrphans,
	clean: handleWorktreeClean,
	recover: handleWorktreeRecover,
}

const EVENTS_HANDLERS: Readonly<Record<string, CommandHandler>> = {
	start: handleEventsStart,
	tail: handleEventsTail,
}

let sigtermCleanupRegistered = false

function ensureSigtermCleanup(): void {
	if (sigtermCleanupRegistered) {
		return
	}
	sigtermCleanupRegistered = true

	process.on('SIGTERM', () => {
		cleanupStaleTempDirs()
		if (process.exitCode === undefined) {
			process.exitCode = EXIT_SIGTERM
		}
	})
}

function getHandler(
	command: CommandGroup,
	subcommand: string,
): CommandHandler | undefined {
	if (command === 'worktree') {
		return WORKTREE_HANDLERS[subcommand]
	}
	return EVENTS_HANDLERS[subcommand]
}

function listSubcommands(command: CommandGroup): string {
	return getCommandsForGroup(command)
		.map((commandDef) => commandDef.subcommand)
		.join(', ')
}

/**
 * Execute the side-quest-git CLI.
 *
 * Why: Central dispatcher that enforces consistent parsing, validation,
 * structured output, and typed failure semantics across all commands.
 */
export async function runCli(argv = process.argv.slice(2)): Promise<void> {
	let outputOptions: OutputOptions = {}

	try {
		ensureSigtermCleanup()

		const parsed = parseArgs(argv)
		const globalOptions = parseGlobalCliOptions(parsed.flags)
		outputOptions = globalOptions.outputOptions

		if (!parsed.command) {
			writeSuccess({ help: generateHelpText() }, outputOptions)
			return
		}

		if (!isCommandGroup(parsed.command)) {
			throw CliError.usage(
				'Usage: side-quest-git <worktree|events> <command> [args]',
			)
		}

		if (!parsed.subcommand) {
			writeSuccess({ help: generateHelpText(parsed.command) }, outputOptions)
			return
		}

		const commandDef = getCommandDef(parsed.command, parsed.subcommand)
		if (!commandDef) {
			if (globalOptions.helpRequested) {
				writeSuccess({ help: generateHelpText(parsed.command) }, outputOptions)
				return
			}
			throw CliError.usage(
				`Unknown ${parsed.command} command: ${parsed.subcommand}. Available: ${listSubcommands(parsed.command)}`,
			)
		}

		if (globalOptions.helpRequested) {
			writeSuccess(
				{ help: generateHelpText(parsed.command, parsed.subcommand) },
				outputOptions,
			)
			return
		}

		validateFlags(
			{ positional: parsed.positional, flags: parsed.flags },
			commandDef,
		)

		const gitRoot = await getMainRoot(process.cwd())
		if (!gitRoot) {
			throw CliError.notFound('Not in a git repository')
		}

		const handler = getHandler(commandDef.command, commandDef.subcommand)
		if (!handler) {
			throw CliError.runtime(
				`No handler registered for ${commandDef.command} ${commandDef.subcommand}`,
			)
		}

		const result = await handler({
			gitRoot,
			positional: parsed.positional,
			flags: parsed.flags,
			nonInteractive: globalOptions.nonInteractive,
			onData: (data) => {
				writeSuccess(data, outputOptions)
			},
			onError: (error) => {
				writeError(error, outputOptions)
			},
		})

		writeSuccess(result.data, outputOptions)
		if (result.exitCode !== undefined) {
			process.exitCode = result.exitCode
		}
		if (result.holdOpen) {
			await result.holdOpen
		}
	} catch (error) {
		const cliError = toCliError(error)
		writeError(cliError, outputOptions)
		process.exitCode = cliError.exitCode
	}
}

if (import.meta.main) {
	void runCli()
}
