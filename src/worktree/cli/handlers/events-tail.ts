import path from 'node:path'
import { getRepoCacheKey } from '../../../events/cache-key.js'
import { connectEventClient } from '../../../events/client.js'
import { readEventServerPort } from '../../../events/server.js'
import { CliError } from '../errors.js'
import { EXIT_INTERRUPTED, EXIT_SIGTERM, type ExitCode } from '../exit-codes.js'
import { parseStringFlag } from '../parsers.js'
import type { CommandContext, CommandResult } from './types.js'

function registerShutdown(
	signal: NodeJS.Signals,
	exitCode: ExitCode,
	shutdown: () => void,
): void {
	process.once(signal, () => {
		shutdown()
		process.exitCode = exitCode
	})
}

/**
 * Handle `events tail`.
 *
 * Why: Streams real-time event envelopes for agent observers.
 */
export async function handleEventsTail(
	context: CommandContext,
): Promise<CommandResult> {
	const typeFilter = parseStringFlag(context.flags, 'type')
	const repoDisplayName = path.basename(context.gitRoot)
	const repoCacheKey = getRepoCacheKey(context.gitRoot)
	const port = readEventServerPort(repoCacheKey)

	if (!port) {
		throw CliError.notFound(
			`No running event server found for repo "${repoDisplayName}". Run: side-quest-git events start`,
		)
	}

	const client = connectEventClient({
		port,
		typeFilter,
		onEvent: (event) => {
			context.onData(event)
		},
		onError: (error) => {
			context.onError(CliError.runtime(error.message, error))
		},
	})

	let closed = false
	const closeClient = () => {
		if (closed) {
			return
		}
		closed = true
		client.close()
	}

	registerShutdown('SIGINT', EXIT_INTERRUPTED, closeClient)
	registerShutdown('SIGTERM', EXIT_SIGTERM, closeClient)
	process.once('beforeExit', closeClient)

	return {
		data: {
			status: 'tailing',
			port,
			type: typeFilter ?? null,
		},
		holdOpen: new Promise<never>(() => {}),
	}
}
