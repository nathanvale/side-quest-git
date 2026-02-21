import {
	type CommandDef,
	EVENTS_COMMANDS,
	GLOBAL_FLAGS,
	getCommandDef,
	getCommandsForGroup,
	isCommandGroup,
	WORKTREE_COMMANDS,
} from './commands.js'

function formatFlag(flag: string): string {
	return `--${flag}`
}

function formatFlags(
	flags: Readonly<Record<string, { description: string }>>,
): string[] {
	const entries = Object.entries(flags).sort(([a], [b]) => a.localeCompare(b))
	if (entries.length === 0) {
		return ['(none)']
	}
	return entries.map(
		([name, def]) => `${formatFlag(name)} - ${def.description}`,
	)
}

function renderCommandHelp(commandDef: CommandDef): string {
	const lines = [
		`Command: ${commandDef.command} ${commandDef.subcommand}`,
		`Description: ${commandDef.description}`,
		`Usage: ${commandDef.usage}`,
		'',
		'Flags:',
		...formatFlags({ ...GLOBAL_FLAGS, ...commandDef.flags }),
	]

	if (commandDef.positional.length > 0) {
		lines.push(
			'',
			'Positional Arguments:',
			...commandDef.positional.map(
				(arg) =>
					`${arg.required ? '<' : '['}${arg.name}${arg.required ? '>' : ']'}`,
			),
		)
	}

	return lines.join('\n')
}

function renderGroupHelp(group: 'worktree' | 'events'): string {
	const commands = getCommandsForGroup(group)
	const lines = [
		`Usage: side-quest-git ${group} <subcommand> [options]`,
		'',
		'Subcommands:',
		...commands.map(
			(commandDef) => `${commandDef.subcommand} - ${commandDef.description}`,
		),
		'',
		'Global Flags:',
		...formatFlags(GLOBAL_FLAGS),
	]
	return lines.join('\n')
}

function renderTopLevelHelp(): string {
	const lines = [
		'Usage: side-quest-git <worktree|events> <subcommand> [options]',
		'',
		'Top-level Commands:',
		'worktree - Worktree lifecycle management',
		'events - Local event bus server and tailing',
		'',
		'Worktree Subcommands:',
		...WORKTREE_COMMANDS.map(
			(commandDef) => `${commandDef.subcommand} - ${commandDef.description}`,
		),
		'',
		'Events Subcommands:',
		...EVENTS_COMMANDS.map(
			(commandDef) => `${commandDef.subcommand} - ${commandDef.description}`,
		),
		'',
		'Global Flags:',
		...formatFlags(GLOBAL_FLAGS),
	]
	return lines.join('\n')
}

/**
 * Generate CLI help text from the command registry.
 */
export function generateHelpText(
	command?: string,
	subcommand?: string,
): string {
	if (command && subcommand) {
		const commandDef = getCommandDef(command, subcommand)
		if (commandDef) {
			return renderCommandHelp(commandDef)
		}
	}

	if (command && isCommandGroup(command)) {
		return renderGroupHelp(command)
	}

	return renderTopLevelHelp()
}
