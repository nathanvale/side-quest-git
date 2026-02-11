/**
 * Live-updating worktree status display (watch TUI).
 *
 * Polls worktree status at a configurable interval and renders
 * a color-coded table to stdout. Requires an interactive terminal.
 *
 * @module worktree/watch
 */

import {
	bold,
	color,
	dim,
	isTTY,
	pad,
	stringWidth,
	truncate,
} from '@side-quest/core/terminal'
import type { WorktreeStatus } from './types.js'

/** Options for the watch loop. */
export interface WatchOptions {
	/** Polling interval in milliseconds (default: 5000). */
	readonly interval?: number
	/** Whether to include PR info from GitHub. */
	readonly includePr?: boolean
}

/** ANSI escape sequence to clear the screen and move cursor to top-left. */
const CLEAR_SCREEN = '\x1b[2J\x1b[H'

/**
 * Start a live-updating worktree status display.
 *
 * Why: Provides at-a-glance visibility into all worktrees without
 * re-running status manually. Useful during multi-branch development
 * sessions where you need to track dirty state and divergence.
 */
export async function watchWorktreeStatus(
	gitRoot: string,
	options: WatchOptions = {},
): Promise<void> {
	if (!isTTY()) {
		throw new Error('--watch requires an interactive terminal (TTY)')
	}

	const { interval = 5000, includePr = false } = options
	const { getWorktreeStatus } = await import('./status.js')

	let running = true

	process.on('SIGINT', () => {
		running = false
		process.stdout.write('\n')
		process.exit(0)
	})

	while (running) {
		const statuses = await getWorktreeStatus(gitRoot, { includePr })
		renderTable(statuses)
		await new Promise((resolve) => setTimeout(resolve, interval))
	}
}

/**
 * Format a relative time string from an ISO 8601 timestamp.
 *
 * Why: Humans parse "2h ago" faster than "2024-01-15T14:30:00+11:00"
 * in a dashboard context where space is tight.
 */
function relativeTime(iso: string): string {
	const now = Date.now()
	const then = new Date(iso).getTime()
	const diffMs = now - then

	if (Number.isNaN(diffMs) || diffMs < 0) return 'just now'

	const seconds = Math.floor(diffMs / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)
	const weeks = Math.floor(days / 7)

	if (weeks > 0) return `${weeks}w ago`
	if (days > 0) return `${days}d ago`
	if (hours > 0) return `${hours}h ago`
	if (minutes > 0) return `${minutes}m ago`
	return 'just now'
}

/**
 * Format the ahead/behind counts as a compact "+N/-M" string.
 *
 * Returns an empty string when both are zero (main branch or in sync).
 */
function formatAheadBehind(ahead: number, behind: number): string {
	if (ahead === 0 && behind === 0) return dim('-')
	const parts: string[] = []
	if (ahead > 0) parts.push(color('red', `+${ahead}`))
	if (behind > 0) parts.push(color('yellow', `-${behind}`))
	return parts.join('/')
}

/**
 * Choose a status color for a worktree row.
 *
 * Green: clean with no divergence from main.
 * Yellow: dirty (uncommitted changes).
 * Red: unmerged commits ahead of main.
 */
function formatDirtyIndicator(dirty: boolean): string {
	return dirty ? color('yellow', 'dirty') : color('green', 'clean')
}

/**
 * Format the branch name with appropriate styling.
 *
 * Main branch gets bold treatment for visual anchoring.
 */
function formatBranch(branch: string, isMain: boolean): string {
	return isMain ? bold(branch) : branch
}

/**
 * Format the last commit info as "time - message".
 */
function formatLastCommit(at: string | null, message: string | null): string {
	if (!at || !message) return dim('no commits')
	const time = relativeTime(at)
	const truncatedMsg = truncate(message, 40)
	return `${dim(time)} ${truncatedMsg}`
}

/** Column definition for the table renderer. */
interface Column {
	readonly header: string
	readonly align: 'left' | 'right'
}

/** Table column definitions. */
const COLUMNS: readonly Column[] = [
	{ header: 'Branch', align: 'left' },
	{ header: 'Status', align: 'left' },
	{ header: 'Ahead/Behind', align: 'right' },
	{ header: 'Last Commit', align: 'left' },
]

/**
 * Render a table of worktree statuses to stdout.
 *
 * Clears the terminal and draws a fresh table each call.
 * Uses ANSI-aware string width calculations for proper alignment
 * even with color codes embedded in cell values.
 */
function renderTable(statuses: readonly WorktreeStatus[]): void {
	// Build rows as string arrays (one per worktree)
	const rows: string[][] = statuses.map((s) => [
		formatBranch(s.branch, s.isMain),
		formatDirtyIndicator(s.dirty),
		formatAheadBehind(s.commitsAhead, s.commitsBehind),
		formatLastCommit(s.lastCommitAt, s.lastCommitMessage),
	])

	// Calculate column widths from headers and data
	const widths: number[] = COLUMNS.map((col) => stringWidth(col.header))
	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			const cellWidth = stringWidth(row[i] ?? '')
			if (cellWidth > (widths[i] ?? 0)) {
				widths[i] = cellWidth
			}
		}
	}

	// Add padding to each column width
	const COL_PADDING = 2
	const paddedWidths = widths.map((w) => w + COL_PADDING)

	// Build header line
	const headerCells = COLUMNS.map((col, i) =>
		bold(pad(col.header, paddedWidths[i]!, col.align)),
	)
	const headerLine = headerCells.join('')

	// Build separator
	const separatorLine = dim(paddedWidths.map((w) => '-'.repeat(w)).join(''))

	// Build data rows
	const dataLines = rows.map((row) =>
		row
			.map((cell, i) => pad(cell, paddedWidths[i]!, COLUMNS[i]!.align))
			.join(''),
	)

	// Compose full output
	const lines: string[] = [
		bold('Worktree Status'),
		dim(`Refreshing every ${dim('...')} -- press Ctrl+C to exit`),
		'',
		headerLine,
		separatorLine,
		...dataLines,
		'',
		dim(`Last updated: ${new Date().toLocaleTimeString()}`),
	]

	process.stdout.write(`${CLEAR_SCREEN + lines.join('\n')}\n`)
}
