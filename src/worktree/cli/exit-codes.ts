/**
 * Typed process exit codes for CLI outcomes.
 *
 * Why: Named constants make command behavior explicit and testable.
 */
export const EXIT_OK = 0
export const EXIT_RUNTIME = 1
export const EXIT_USAGE = 2
export const EXIT_NOT_FOUND = 3
export const EXIT_CONFLICT = 5
export const EXIT_INTERRUPTED = 130
export const EXIT_SIGTERM = 143

/**
 * Supported exit code union for the CLI.
 */
export type ExitCode =
	| typeof EXIT_OK
	| typeof EXIT_RUNTIME
	| typeof EXIT_USAGE
	| typeof EXIT_NOT_FOUND
	| typeof EXIT_CONFLICT
	| typeof EXIT_INTERRUPTED
	| typeof EXIT_SIGTERM
