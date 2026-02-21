import type { ExitCode } from '../exit-codes.js'
import type { CliFlags } from '../parsers.js'

/**
 * Shared command handler execution context.
 */
export interface CommandContext {
	readonly gitRoot: string
	readonly positional: readonly string[]
	readonly flags: CliFlags
	readonly nonInteractive: boolean
	readonly onData: (data: unknown) => void
	readonly onError: (error: unknown) => void
}

/**
 * Structured command handler result consumed by the dispatcher.
 */
export interface CommandResult {
	readonly data: unknown
	readonly exitCode?: ExitCode
	readonly holdOpen?: Promise<never>
}

/**
 * Command handler function signature.
 */
export type CommandHandler = (context: CommandContext) => Promise<CommandResult>
