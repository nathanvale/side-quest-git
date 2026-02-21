import {
	type CommandDef,
	type FlagDef,
	GLOBAL_FLAGS,
	type PositionalDef,
} from './commands.js'
import { CliError } from './errors.js'
import type { CliFlags, CliRawFlagValue } from './parsers.js'

interface ParsedCliInput {
	readonly positional: readonly string[]
	readonly flags: CliFlags
}

function assertFlagValueType(
	flagName: string,
	value: CliRawFlagValue,
	def: FlagDef,
): void {
	if (Array.isArray(value)) {
		throw CliError.usage(`Flag --${flagName} may only be specified once`)
	}

	if (def.kind === 'boolean') {
		if (value !== undefined && value !== true) {
			throw CliError.usage(
				`Invalid --${flagName} value: this flag does not take a value`,
			)
		}
		return
	}

	if (value !== undefined && typeof value !== 'string') {
		throw CliError.usage(`Invalid --${flagName} value: expected a string`)
	}
}

function validatePositionalArgs(
	positional: readonly string[],
	commandDef: CommandDef,
): void {
	const required = commandDef.positional.filter((arg) => arg.required)
	if (positional.length < required.length) {
		const missingNames = required
			.slice(positional.length)
			.map((arg: PositionalDef) => `<${arg.name}>`)
			.join(', ')
		throw CliError.usage(
			`Missing required argument(s): ${missingNames}. Usage: ${commandDef.usage}`,
		)
	}

	const hasVariadic = commandDef.positional.some((arg) => arg.variadic)
	if (!hasVariadic && positional.length > commandDef.positional.length) {
		throw CliError.usage(
			`Too many positional arguments. Usage: ${commandDef.usage}`,
		)
	}
}

/**
 * Validate command flags against the command registry schema.
 *
 * Why: Explicit flag validation avoids silent typos and catches
 * malformed invocations before domain logic executes.
 */
export function validateFlags(
	parsed: ParsedCliInput,
	commandDef: CommandDef,
): void {
	const allowedFlags = new Map<string, FlagDef>([
		...Object.entries(GLOBAL_FLAGS),
		...Object.entries(commandDef.flags),
	])

	for (const [flagName, value] of Object.entries(parsed.flags)) {
		const flagDef = allowedFlags.get(flagName)
		if (!flagDef) {
			throw CliError.usage(
				`Unknown flag --${flagName} for ${commandDef.command} ${commandDef.subcommand}. Usage: ${commandDef.usage}`,
			)
		}
		assertFlagValueType(flagName, value, flagDef)
	}

	validatePositionalArgs(parsed.positional, commandDef)
}
