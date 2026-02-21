/**
 * Command namespace groups.
 */
export type CommandGroup = 'worktree' | 'events'

/**
 * Supported flag value kinds.
 */
export type FlagKind = 'boolean' | 'string'

/**
 * Flag schema for validation/help rendering.
 */
export interface FlagDef {
	readonly kind: FlagKind
	readonly description: string
}

/**
 * Positional argument schema for usage checks.
 */
export interface PositionalDef {
	readonly name: string
	readonly required?: boolean
	readonly variadic?: boolean
}

/**
 * Command metadata contract.
 */
export interface CommandDef {
	readonly command: CommandGroup
	readonly subcommand: string
	readonly description: string
	readonly usage: string
	readonly positional: readonly PositionalDef[]
	readonly flags: Readonly<Record<string, FlagDef>>
}

function boolFlag(description: string): FlagDef {
	return { kind: 'boolean', description }
}

function stringFlag(description: string): FlagDef {
	return { kind: 'string', description }
}

/**
 * Global flags accepted by every command.
 */
export const GLOBAL_FLAGS: Readonly<Record<string, FlagDef>> = {
	json: boolFlag('No-op compatibility flag; output is always JSON'),
	jsonl: boolFlag('Emit compact JSON lines'),
	quiet: boolFlag('Suppress stdout success output'),
	help: boolFlag('Show auto-generated usage information'),
	fields: stringFlag('Comma-separated projection list (dot paths allowed)'),
	'non-interactive': boolFlag(
		'Disable interactive behavior for agent contexts',
	),
}

/**
 * Worktree command registry.
 */
export const WORKTREE_COMMANDS: readonly CommandDef[] = [
	{
		command: 'worktree',
		subcommand: 'create',
		description: 'Create or attach to a branch worktree',
		usage:
			'side-quest-git worktree create <branch-name> [--no-install] [--no-fetch] [--no-attach] [--base <ref>]',
		positional: [{ name: 'branch-name', required: true }],
		flags: {
			'no-install': boolFlag('Skip post-create install hook'),
			'no-fetch': boolFlag('Skip remote fetch before creating branch'),
			'no-attach': boolFlag('Do not attach to an existing matching worktree'),
			base: stringFlag('Base branch/tag/commit ref'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'list',
		description: 'List worktrees with health metadata',
		usage:
			'side-quest-git worktree list [--all] [--include-orphans] [--timeout <ms>] [--shallow-ok]',
		positional: [],
		flags: {
			all: boolFlag('Include main worktree'),
			'include-orphans': boolFlag('Include orphan branch analysis'),
			timeout: stringFlag('Detection timeout in milliseconds'),
			'shallow-ok': boolFlag('Allow merge detection in shallow clones'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'delete',
		description: 'Delete a worktree by branch name',
		usage:
			'side-quest-git worktree delete <branch-name> [--force] [--delete-branch]',
		positional: [{ name: 'branch-name', required: true }],
		flags: {
			force: boolFlag('Delete even when dirty/unmerged'),
			'delete-branch': boolFlag('Delete branch ref after worktree removal'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'check',
		description: 'Check deletion safety for a worktree branch',
		usage:
			'side-quest-git worktree check <branch-name> [--timeout <ms>] [--shallow-ok]',
		positional: [{ name: 'branch-name', required: true }],
		flags: {
			timeout: stringFlag('Detection timeout in milliseconds'),
			'shallow-ok': boolFlag('Allow merge detection in shallow clones'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'init',
		description: 'Initialize .worktrees.json config',
		usage: 'side-quest-git worktree init',
		positional: [],
		flags: {},
	},
	{
		command: 'worktree',
		subcommand: 'install',
		description: 'Run installer for a target path',
		usage: 'side-quest-git worktree install <path> [--force]',
		positional: [{ name: 'path', required: true }],
		flags: {
			force: boolFlag('Run install even when lockfiles are missing'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'sync',
		description: 'Sync shared files into one or all worktrees',
		usage:
			'side-quest-git worktree sync <branch> [--dry-run] or side-quest-git worktree sync --all [--dry-run]',
		positional: [{ name: 'branch', required: false }],
		flags: {
			'dry-run': boolFlag('Show planned sync actions without writing files'),
			all: boolFlag('Sync every worktree'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'status',
		description: 'Get worktree status snapshots or watch mode',
		usage:
			'side-quest-git worktree status [--pr] [--watch] [--interval <seconds>]',
		positional: [],
		flags: {
			pr: boolFlag('Include GitHub PR metadata when available'),
			watch: boolFlag('Run live updating status view'),
			interval: stringFlag('Watch interval in seconds'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'orphans',
		description: 'List orphan branches with health metadata',
		usage: 'side-quest-git worktree orphans [--timeout <ms>] [--shallow-ok]',
		positional: [],
		flags: {
			timeout: stringFlag('Detection timeout in milliseconds'),
			'shallow-ok': boolFlag('Allow detection in shallow clones'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'clean',
		description: 'Delete eligible worktrees and optional orphan branches',
		usage:
			'side-quest-git worktree clean [--dry-run] [--force] [--delete-branches] [--include-orphans] [--timeout <ms>] [--shallow-ok]',
		positional: [],
		flags: {
			'dry-run': boolFlag('Show planned cleanup actions only'),
			force: boolFlag('Allow deleting dirty/unmerged worktrees'),
			'delete-branches': boolFlag('Delete branch refs after cleanup'),
			'include-orphans': boolFlag('Also clean orphan branches'),
			timeout: stringFlag('Detection timeout in milliseconds'),
			'shallow-ok': boolFlag('Allow detection in shallow clones'),
		},
	},
	{
		command: 'worktree',
		subcommand: 'recover',
		description: 'List, restore, or cleanup branch backup refs',
		usage:
			'side-quest-git worktree recover [<branch>] [--cleanup] [--max-age <days>]',
		positional: [{ name: 'branch', required: false }],
		flags: {
			cleanup: boolFlag('Delete stale backup refs'),
			'max-age': stringFlag('Retention window in days for cleanup mode'),
		},
	},
]

/**
 * Events command registry.
 */
export const EVENTS_COMMANDS: readonly CommandDef[] = [
	{
		command: 'events',
		subcommand: 'start',
		description: 'Start the local event server',
		usage: 'side-quest-git events start [--port <1..65535>]',
		positional: [],
		flags: {
			port: stringFlag('Port to bind the event server to'),
		},
	},
	{
		command: 'events',
		subcommand: 'tail',
		description: 'Tail events from the running local server',
		usage: 'side-quest-git events tail [--type <eventType>]',
		positional: [],
		flags: {
			type: stringFlag('Optional event type filter'),
		},
	},
]

const COMMANDS_BY_KEY = new Map<string, CommandDef>(
	[...WORKTREE_COMMANDS, ...EVENTS_COMMANDS].map((commandDef) => [
		`${commandDef.command}:${commandDef.subcommand}`,
		commandDef,
	]),
)

/**
 * Look up command metadata from the registry.
 */
export function getCommandDef(
	command: string,
	subcommand: string | undefined,
): CommandDef | undefined {
	if (!subcommand) {
		return undefined
	}
	return COMMANDS_BY_KEY.get(`${command}:${subcommand}`)
}

/**
 * Get all command definitions for a command group.
 */
export function getCommandsForGroup(
	command: CommandGroup,
): readonly CommandDef[] {
	return command === 'worktree' ? WORKTREE_COMMANDS : EVENTS_COMMANDS
}

/**
 * Type guard for top-level command names.
 */
export function isCommandGroup(command: string): command is CommandGroup {
	return command === 'worktree' || command === 'events'
}
