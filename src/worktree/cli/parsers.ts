import { CliError } from './errors.js'
import type { OutputOptions } from './output.js'
import { validateFieldPaths } from './project.js'

/**
 * Raw CLI flag value from `parseArgs`.
 */
export type CliRawFlagValue =
	| string
	| boolean
	| (string | boolean)[]
	| undefined

/**
 * Parsed CLI flags from `parseArgs`.
 */
export type CliFlags = Record<string, string | boolean | (string | boolean)[]>

/**
 * Parsed global options consumed by the dispatcher.
 */
export interface GlobalCliOptions {
	readonly outputOptions: OutputOptions
	readonly helpRequested: boolean
	readonly nonInteractive: boolean
}

function unwrapFlagValue(
	value: CliRawFlagValue,
	flagName: string,
): string | boolean | undefined {
	if (Array.isArray(value)) {
		throw CliError.usage(`Flag --${flagName} may only be specified once`)
	}
	return value
}

/**
 * Parse a boolean flag with strict "no value" semantics.
 */
export function parseBooleanFlag(flags: CliFlags, flagName: string): boolean {
	const value = unwrapFlagValue(flags[flagName], flagName)
	if (value === undefined) {
		return false
	}
	if (value === true) {
		return true
	}
	throw CliError.usage(
		`Invalid --${flagName} value: this flag does not take a value`,
	)
}

/**
 * Parse an optional string flag.
 */
export function parseStringFlag(
	flags: CliFlags,
	flagName: string,
): string | undefined {
	const value = unwrapFlagValue(flags[flagName], flagName)
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string') {
		throw CliError.usage(`Invalid --${flagName} value: expected a string`) // boolean true
	}
	return value
}

/**
 * Parse global output/control flags.
 *
 * Why: Centralized parsing keeps command handlers focused on domain logic.
 */
export function parseGlobalCliOptions(flags: CliFlags): GlobalCliOptions {
	const jsonRequested = parseBooleanFlag(flags, 'json')
	void jsonRequested // JSON is always the only output format.

	const jsonl = parseBooleanFlag(flags, 'jsonl')
	const quiet = parseBooleanFlag(flags, 'quiet')
	const helpRequested = parseBooleanFlag(flags, 'help')
	const nonInteractiveFlag = parseBooleanFlag(flags, 'non-interactive')
	const fields = parseFieldsFlag(flags)

	return {
		outputOptions: {
			jsonl,
			quiet,
			fields,
		},
		helpRequested,
		nonInteractive: nonInteractiveFlag || !process.stdout.isTTY,
	}
}

/**
 * Parse `--port` for `events start`.
 */
export function parsePort(portFlag: CliRawFlagValue): number {
	const value = unwrapFlagValue(portFlag, 'port')
	if (value === undefined) {
		return 7483
	}
	if (typeof value !== 'string') {
		throw CliError.usage(
			'Invalid --port value: expected a number between 1 and 65535',
		)
	}
	const port = Number.parseInt(value, 10)
	if (!Number.isFinite(port) || port < 1 || port > 65535) {
		throw CliError.usage(
			'Invalid --port value: expected a number between 1 and 65535',
		)
	}
	return port
}

/**
 * Parse `--base` for `worktree create`.
 */
export function parseBaseRef(baseFlag: CliRawFlagValue): string | undefined {
	const value = unwrapFlagValue(baseFlag, 'base')
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw CliError.usage(
			'Invalid --base value: expected a branch, tag, or commit ref',
		)
	}
	return value
}

/**
 * Parse `--interval` for `worktree status --watch`.
 */
export function parseWatchIntervalMs(
	intervalFlag: CliRawFlagValue,
): number | undefined {
	const value = unwrapFlagValue(intervalFlag, 'interval')
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw CliError.usage(
			'Invalid --interval value: expected a positive integer in seconds',
		)
	}
	const seconds = Number.parseInt(value, 10)
	if (!Number.isFinite(seconds) || seconds <= 0) {
		throw CliError.usage(
			'Invalid --interval value: expected a positive integer in seconds',
		)
	}
	return seconds * 1000
}

/**
 * Parse `--timeout` for detection-aware worktree commands.
 */
export function parseDetectionTimeoutMs(
	timeoutFlag: CliRawFlagValue,
): number | undefined {
	const value = unwrapFlagValue(timeoutFlag, 'timeout')
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw CliError.usage(
			'Invalid --timeout value: expected a positive integer in milliseconds',
		)
	}
	const ms = Number.parseInt(value, 10)
	if (!Number.isFinite(ms) || ms <= 0) {
		throw CliError.usage(
			'Invalid --timeout value: expected a positive integer in milliseconds',
		)
	}
	return ms
}

/**
 * Parse `--max-age` for `worktree recover --cleanup`.
 */
export function parseMaxAgeDays(maxAgeFlag: CliRawFlagValue): number {
	const value = unwrapFlagValue(maxAgeFlag, 'max-age')
	if (value === undefined) {
		return 30
	}
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw CliError.usage(
			'Invalid --max-age value: expected a positive integer (number of days)',
		)
	}
	const days = Number.parseInt(value, 10)
	if (days < 1) {
		throw CliError.usage(
			'Invalid --max-age value: expected a positive integer (number of days)',
		)
	}
	return days
}

/**
 * Parse optional `--fields` list.
 */
export function parseFieldsFlag(
	flags: CliFlags,
): readonly string[] | undefined {
	const value = unwrapFlagValue(flags.fields, 'fields')
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string') {
		throw CliError.usage(
			'Invalid --fields value: expected a comma-separated list',
		)
	}

	const fields = value
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)

	if (fields.length === 0) {
		throw CliError.usage('Invalid --fields value: expected at least one field')
	}

	validateFieldPaths(fields)
	return fields
}
