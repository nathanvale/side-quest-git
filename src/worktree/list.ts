/**
 * Worktree listing with status enrichment.
 */

import { processInParallelChunks } from '@side-quest/core/concurrency'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import { DEFAULT_CONCURRENCY } from './constants.js'
import { debugLog } from './debug.js'
import { createDetectionIssue, DETECTION_CODES } from './detection-issue.js'
import { parseEnvInt } from './env.js'
import { checkIsShallow, detectMergeStatus } from './merge-status.js'
import { buildStatusString } from './status-string.js'
import type { WorktreeInfo } from './types.js'
import { checkUpstreamGone } from './upstream-gone.js'

/** Options for listWorktrees. */
export interface ListWorktreesOptions {
	/**
	 * Override the Layer 3 cherry detection timeout in milliseconds.
	 *
	 * Why: Allows callers (e.g. `--timeout` CLI flag) to tune squash detection
	 * per-run without touching env vars. Precedence: this value >
	 * SIDE_QUEST_DETECTION_TIMEOUT_MS env var > default 5000ms.
	 */
	detectionTimeout?: number
	/**
	 * Skip the shallow clone guard during merge detection.
	 *
	 * Why: CI environments often use shallow clones. Pass this when clone depth
	 * is known to be sufficient for the branches under inspection.
	 */
	shallowOk?: boolean
	/**
	 * Max worktrees to process in parallel.
	 *
	 * Why: Allows callers to tune git subprocess fan-out per-run without
	 * touching env vars. Precedence: this value >
	 * SIDE_QUEST_CONCURRENCY env var > DEFAULT_CONCURRENCY (4).
	 */
	concurrency?: number
}

/**
 * List all worktrees in the repository with enriched status.
 *
 * @param gitRoot - Main worktree root
 * @param options - Options including optional detection timeout override
 * @returns Array of enriched worktree info objects
 */
export async function listWorktrees(
	gitRoot: string,
	options: ListWorktreesOptions = {},
): Promise<WorktreeInfo[]> {
	const result = await spawnAndCollect(
		['git', 'worktree', 'list', '--porcelain'],
		{
			cwd: gitRoot,
		},
	)
	if (result.exitCode !== 0) {
		throw new Error(`Failed to list worktrees: ${result.stderr.trim()}`)
	}

	const entries = parsePorcelainOutput(result.stdout)
	const mainBranch = await getMainBranch(gitRoot)
	// Skip shallow check when detection is fully disabled -- no git subprocesses
	// should run at all during an incident (SIDE_QUEST_NO_DETECTION=1).
	const isShallow =
		process.env.SIDE_QUEST_NO_DETECTION === '1'
			? null
			: await checkIsShallow(gitRoot)

	// Per-item timeout: cap how long a single enrichWorktreeInfo call may run.
	// A hung git process (e.g. in a network-mounted repo) would otherwise block
	// the entire chunk. The timeout is intentionally generous -- it is a safety
	// net, not a performance target.
	const itemTimeoutMs = parseEnvInt('SIDE_QUEST_ITEM_TIMEOUT_MS', 10000, {
		min: 1,
	})

	const rawConcurrency =
		options.concurrency ??
		parseEnvInt('SIDE_QUEST_CONCURRENCY', DEFAULT_CONCURRENCY, { min: 1 })
	const concurrency =
		Number.isFinite(rawConcurrency) && rawConcurrency >= 1
			? Math.floor(rawConcurrency)
			: DEFAULT_CONCURRENCY

	// Sanitise detectionTimeout: only pass finite positive values downstream.
	const detectionTimeout =
		options.detectionTimeout !== undefined &&
		Number.isFinite(options.detectionTimeout) &&
		options.detectionTimeout > 0
			? options.detectionTimeout
			: undefined

	const total = entries.length
	let processed = 0
	let failureCount = 0
	const enrichStart = Date.now()

	const results = await processInParallelChunks({
		items: [...entries],
		chunkSize: concurrency,
		processor: async (entry) => {
			const signal = AbortSignal.timeout(itemTimeoutMs)
			const result = await enrichWorktreeInfo(
				entry,
				mainBranch,
				gitRoot,
				isShallow,
				signal,
				detectionTimeout,
				options.shallowOk,
			)
			processed++
			debugLog('enrichment:progress', {
				branch: entry.branch,
				processed,
				total,
			})
			return result
		},
		onError: (entry, error) => {
			// Compute isMain from raw entry data to preserve safety invariant.
			// cleanWorktrees trusts isMain to guard against deleting the main worktree.
			const isMain =
				entry.isBare ||
				entry.branch === mainBranch ||
				entry.branch === 'main' ||
				entry.branch === 'master'
			const errorMsg = error instanceof Error ? error.message : String(error)
			const issues = [
				createDetectionIssue(
					DETECTION_CODES.ENRICHMENT_FAILED,
					'error',
					'enrichment',
					errorMsg,
					false,
				),
			]
			processed++
			failureCount++
			debugLog('enrichment:error', {
				branch: entry.branch,
				error: errorMsg,
				processed,
				total,
			})
			return {
				branch: entry.branch,
				path: entry.path,
				head: entry.head,
				dirty: false,
				merged: false,
				isMain,
				status: 'enrichment failed',
				detectionError: errorMsg,
				issues,
			} satisfies WorktreeInfo
		},
	})

	debugLog('enrichment:complete', {
		total,
		durationMs: Date.now() - enrichStart,
		failureCount,
	})

	return results
}

interface RawWorktreeEntry {
	path: string
	head: string
	branch: string
	isBare: boolean
}

function parsePorcelainOutput(output: string): RawWorktreeEntry[] {
	const entries: RawWorktreeEntry[] = []
	const blocks = output.trim().split('\n\n')

	for (const block of blocks) {
		if (!block.trim()) {
			continue
		}

		const lines = block.trim().split('\n')
		let entryPath = ''
		let head = ''
		let branch = ''
		let isBare = false

		for (const line of lines) {
			if (line.startsWith('worktree ')) {
				entryPath = line.slice('worktree '.length)
			} else if (line.startsWith('HEAD ')) {
				head = line.slice('HEAD '.length).slice(0, 7)
			} else if (line.startsWith('branch ')) {
				branch = line.slice('branch '.length).replace('refs/heads/', '')
			} else if (line === 'bare') {
				isBare = true
			} else if (line === 'detached') {
				branch = '(detached)'
			}
		}

		if (entryPath) {
			entries.push({ path: entryPath, head, branch, isBare })
		}
	}

	return entries
}

async function enrichWorktreeInfo(
	entry: RawWorktreeEntry,
	mainBranch: string,
	gitRoot: string,
	isShallow: boolean | null,
	signal?: AbortSignal,
	detectionTimeout?: number,
	shallowOk?: boolean,
): Promise<WorktreeInfo> {
	const isMain =
		entry.isBare ||
		entry.branch === mainBranch ||
		entry.branch === 'main' ||
		entry.branch === 'master'

	const dirty = await isDirty(entry.path)

	if (isMain || entry.branch === '(detached)') {
		return {
			branch: entry.branch,
			path: entry.path,
			head: entry.head,
			dirty,
			merged: isMain,
			isMain,
		}
	}

	// Run merge detection and upstream-gone check concurrently -- they are
	// independent git calls and neither blocks the other.
	const [detection, upstreamGone] = await Promise.all([
		detectMergeStatus(gitRoot, entry.branch, mainBranch, {
			isShallow,
			signal,
			...(detectionTimeout !== undefined ? { timeout: detectionTimeout } : {}),
			...(shallowOk !== undefined ? { shallowOk } : {}),
		}),
		checkUpstreamGone(gitRoot, entry.branch),
	])

	const status = buildStatusString({
		merged: detection.merged,
		dirty,
		commitsAhead: detection.commitsAhead,
		commitsBehind: detection.commitsBehind,
		mergeMethod: detection.mergeMethod,
	})

	return {
		branch: entry.branch,
		path: entry.path,
		head: entry.head,
		dirty,
		merged: detection.merged,
		isMain,
		commitsAhead: detection.commitsAhead,
		commitsBehind: detection.commitsBehind,
		mergeMethod: detection.mergeMethod,
		status,
		detectionError: detection.detectionError,
		issues: detection.issues,
		// Only include the field when it is true to keep output clean for the common case.
		...(upstreamGone ? { upstreamGone: true } : {}),
	}
}

async function isDirty(worktreePath: string): Promise<boolean> {
	const result = await spawnAndCollect(['git', 'status', '--porcelain'], {
		cwd: worktreePath,
	})
	return result.exitCode === 0 && result.stdout.trim().length > 0
}
