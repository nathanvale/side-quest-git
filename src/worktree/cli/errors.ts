import {
	EXIT_CONFLICT,
	EXIT_NOT_FOUND,
	EXIT_RUNTIME,
	EXIT_USAGE,
	type ExitCode,
} from './exit-codes.js'

/**
 * Stable machine-readable CLI error codes.
 */
export type CliErrorCode =
	| 'E_USAGE'
	| 'E_RUNTIME'
	| 'E_NOT_FOUND'
	| 'E_CONFLICT'

/**
 * Structured error envelope written to stderr.
 */
export interface CliErrorEnvelope {
	readonly status: 'error'
	readonly error: {
		readonly code: CliErrorCode
		readonly name: string
		readonly message: string
	}
}

interface CliErrorOptions {
	readonly code: CliErrorCode
	readonly message: string
	readonly exitCode: ExitCode
	readonly name?: string
	readonly cause?: unknown
}

/**
 * Typed CLI error carrying a stable code and exit code.
 *
 * Why: Centralizing error metadata keeps failure handling deterministic
 * for agent and script consumers.
 */
export class CliError extends Error {
	readonly code: CliErrorCode
	readonly exitCode: ExitCode
	override readonly name: string

	constructor(options: CliErrorOptions) {
		super(options.message, { cause: options.cause })
		this.code = options.code
		this.exitCode = options.exitCode
		this.name = options.name ?? 'CliError'
	}

	/**
	 * Build a usage error (`exit 2`).
	 */
	static usage(message: string): CliError {
		return new CliError({
			code: 'E_USAGE',
			message,
			exitCode: EXIT_USAGE,
			name: 'UsageError',
		})
	}

	/**
	 * Build a not-found error (`exit 3`).
	 */
	static notFound(message: string): CliError {
		return new CliError({
			code: 'E_NOT_FOUND',
			message,
			exitCode: EXIT_NOT_FOUND,
			name: 'NotFoundError',
		})
	}

	/**
	 * Build a conflict error (`exit 5`).
	 */
	static conflict(message: string): CliError {
		return new CliError({
			code: 'E_CONFLICT',
			message,
			exitCode: EXIT_CONFLICT,
			name: 'ConflictError',
		})
	}

	/**
	 * Build a generic runtime error (`exit 1`).
	 */
	static runtime(message: string, cause?: unknown): CliError {
		return new CliError({
			code: 'E_RUNTIME',
			message,
			exitCode: EXIT_RUNTIME,
			name: 'RuntimeError',
			cause,
		})
	}
}

/**
 * Normalize unknown thrown values into a `CliError`.
 */
export function toCliError(error: unknown): CliError {
	if (error instanceof CliError) {
		return error
	}

	if (error instanceof Error) {
		if (/already running|already exists|conflict/i.test(error.message)) {
			return CliError.conflict(error.message)
		}
		return CliError.runtime(error.message || 'Unknown runtime error', error)
	}

	return CliError.runtime(String(error))
}
