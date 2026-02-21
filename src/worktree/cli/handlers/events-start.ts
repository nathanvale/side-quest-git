import path from 'node:path'
import { getRepoCacheKey } from '../../../events/cache-key.js'
import { startEventServer } from '../../../events/server.js'
import { EXIT_INTERRUPTED, EXIT_SIGTERM, type ExitCode } from '../exit-codes.js'
import { parsePort } from '../parsers.js'
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
 * Handle `events start`.
 *
 * Why: Starts the long-running local event server used by CLI telemetry.
 */
export async function handleEventsStart(
	context: CommandContext,
): Promise<CommandResult> {
	const port = parsePort(context.flags.port)
	const repoDisplayName = path.basename(context.gitRoot)
	const repoCacheKey = getRepoCacheKey(context.gitRoot)

	const server = startEventServer({
		port,
		repoName: repoDisplayName,
		cacheKey: repoCacheKey,
		gitRoot: context.gitRoot,
	})

	let stopped = false
	const stopServer = () => {
		if (stopped) {
			return
		}
		stopped = true
		server.stop()
	}

	registerShutdown('SIGINT', EXIT_INTERRUPTED, stopServer)
	registerShutdown('SIGTERM', EXIT_SIGTERM, stopServer)
	process.once('beforeExit', stopServer)

	return {
		data: { status: 'started', port: server.port, pid: process.pid },
		holdOpen: new Promise<never>(() => {}),
	}
}
