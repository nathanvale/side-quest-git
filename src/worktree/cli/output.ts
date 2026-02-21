import type { CliErrorEnvelope } from './errors.js'
import { toCliError } from './errors.js'
import { projectFields } from './project.js'

/**
 * Output shaping options shared by success and error writers.
 */
export interface OutputOptions {
	readonly jsonl?: boolean
	readonly quiet?: boolean
	readonly fields?: readonly string[]
}

/**
 * Structured success envelope written to stdout.
 */
export interface CliSuccessEnvelope<TData = unknown> {
	readonly status: 'ok'
	readonly data: TData
}

function stringify(value: unknown, jsonl: boolean): string {
	return jsonl ? JSON.stringify(value) : JSON.stringify(value, null, 2)
}

/**
 * Write a success envelope to stdout.
 *
 * Why: A consistent envelope lets downstream agents parse success payloads
 * without command-specific shape checks.
 */
export function writeSuccess(data: unknown, options: OutputOptions = {}): void {
	const { jsonl = false, quiet = false, fields } = options
	if (quiet) {
		return
	}

	const projected = projectFields(data, fields)
	const envelope: CliSuccessEnvelope = { status: 'ok', data: projected }
	process.stdout.write(`${stringify(envelope, jsonl)}\n`)
}

/**
 * Write a structured error envelope to stderr.
 */
export function writeError(error: unknown, options: OutputOptions = {}): void {
	const { jsonl = false } = options
	const cliError = toCliError(error)
	const envelope: CliErrorEnvelope = {
		status: 'error',
		error: {
			code: cliError.code,
			name: cliError.name,
			message: cliError.message,
		},
	}
	process.stderr.write(`${stringify(envelope, jsonl)}\n`)
}
