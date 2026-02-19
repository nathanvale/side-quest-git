/**
 * Merge detection with squash-merge awareness.
 *
 * Three-layer cascade determines if a branch is integrated into a target:
 * 1. Ancestor check (git merge-base --is-ancestor)
 * 2. Ahead/behind counts (git rev-list --count --left-right)
 * 3. Squash detection (git commit-tree + git cherry in isolated object store)
 *
 * Squash detection creates a synthetic commit representing a squash of the branch
 * (feature tree with merge-base as parent) and uses git cherry to check if an
 * equivalent patch exists in the target branch. The synthetic commit is written
 * to a temporary object directory so repository object storage remains unchanged.
 *
 * @module worktree/merge-status
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { getMainBranch } from '../git/main-branch.js'
import type { MergeMethod } from './types.js'

/**
 * Debounce flag: janitor only runs once per process lifetime.
 *
 * Why: Scanning tmpdir on every detectMergeStatus call would be wasteful.
 * One scan at startup is sufficient to clean up dead PIDs from prior runs.
 */
let _janitorRan = false

/**
 * Remove stale sq-git-objects-* temp directories left by dead processes.
 *
 * Scans os.tmpdir() for directories matching `sq-git-objects-*`. For each:
 * - Extracts PID from the directory name
 * - If the PID is no longer alive OR the dir is older than 1 hour, removes it
 *
 * This function is intentionally synchronous (one-time scan at startup) and
 * NEVER throws -- it is a janitor and must not break detection.
 */
export function cleanupStaleTempDirs(): void {
	try {
		const tmp = tmpdir()
		const entries = readdirSync(tmp)
		const now = Date.now()
		const oneHourMs = 60 * 60 * 1000

		for (const entry of entries) {
			if (!entry.startsWith('sq-git-objects-')) continue

			const fullPath = path.join(tmp, entry)

			try {
				// Extract PID from name: sq-git-objects-<pid>-<random>
				const pidMatch = /^sq-git-objects-(\d+)-/.exec(entry)
				let isStale = false

				if (pidMatch?.[1]) {
					const pid = Number.parseInt(pidMatch[1], 10)
					try {
						// process.kill(pid, 0) returns without error if alive
						process.kill(pid, 0)
						// Process is alive -- check age as secondary guard
						const stat = statSync(fullPath)
						isStale = now - stat.mtimeMs > oneHourMs
					} catch {
						// ESRCH: process not found -- definitely stale
						isStale = true
					}
				} else {
					// No PID in name -- check age only (legacy format)
					try {
						const stat = statSync(fullPath)
						isStale = now - stat.mtimeMs > oneHourMs
					} catch {
						isStale = true
					}
				}

				if (isStale) {
					rmSync(fullPath, { recursive: true, force: true })
				}
			} catch {
				// Ignore errors per-entry -- janitor must never throw
			}
		}
	} catch {
		// Ignore top-level errors -- janitor must never throw
	}
}

/** Result of merge detection analysis. */
export interface MergeDetectionResult {
	readonly merged: boolean
	readonly mergeMethod?: MergeMethod
	readonly commitsAhead: number
	readonly commitsBehind: number
	readonly detectionError?: string
}

/** Options for merge detection. */
export interface DetectionOptions {
	readonly timeout?: number
	readonly maxCommitsForSquashDetection?: number
	/** Pre-computed shallow clone status. true = shallow, false = not shallow, null = check failed. */
	readonly isShallow?: boolean | null
	/**
	 * AbortSignal to cancel detection early.
	 *
	 * Why: per-item timeouts in list/orphan callers wrap each call with
	 * AbortSignal.timeout(). Threading the signal lets git subprocesses
	 * terminate promptly rather than running until natural completion.
	 */
	readonly signal?: AbortSignal
}

/**
 * Check if a git repository is a shallow clone.
 *
 * @param gitRoot - Absolute path to git repository root
 * @returns true if shallow, false if not, null if check failed
 */
export async function checkIsShallow(gitRoot: string): Promise<boolean | null> {
	const result = await spawnAndCollect(
		['git', 'rev-parse', '--is-shallow-repository'],
		{ cwd: gitRoot },
	)
	if (result.exitCode !== 0) return null
	return result.stdout.trim() === 'true'
}

/**
 * Detect if a branch has been merged into a target branch.
 *
 * Uses a three-layer detection cascade:
 * 1. Ancestor check via merge-base
 * 2. Ahead/behind commit counts
 * 3. Squash detection via synthetic commit + cherry
 *
 * @param gitRoot - Absolute path to git repository root
 * @param branch - Branch name to check
 * @param targetBranch - Target branch (defaults to main/master)
 * @param options - Detection options (timeout, threshold)
 * @returns Merge detection result with method and commit counts
 */
export async function detectMergeStatus(
	gitRoot: string,
	branch: string,
	targetBranch?: string,
	options: DetectionOptions = {},
): Promise<MergeDetectionResult> {
	// Janitor: clean up stale temp dirs from prior crashed/killed runs.
	// Fire-and-forget, debounced -- runs at most once per process lifetime.
	if (!_janitorRan) {
		_janitorRan = true
		cleanupStaleTempDirs()
	}

	// Incident-grade kill switch: set SIDE_QUEST_NO_DETECTION=1 to bypass ALL
	// detection layers (Layers 1, 2, 3) and all git subprocess calls. Use this
	// during incidents when git operations are hanging or causing cascading
	// failures. For targeted Layer 3 disable only, use
	// SIDE_QUEST_NO_SQUASH_DETECTION=1 instead (backward compat preserved).
	if (process.env.SIDE_QUEST_NO_DETECTION === '1') {
		return {
			merged: false,
			commitsAhead: -1,
			commitsBehind: -1,
			detectionError: 'detection disabled',
		}
	}

	const timeout = options.timeout ?? 5000
	const maxCommitsForSquashDetection =
		options.maxCommitsForSquashDetection ?? 50
	const signal = options.signal

	// Early-exit if the caller's signal is already aborted before any git work.
	// This prevents spawning subprocesses that would be immediately killed.
	if (signal?.aborted) {
		return {
			merged: false,
			commitsAhead: -1,
			commitsBehind: -1,
			detectionError: 'detection aborted',
		}
	}

	// Shallow clone guard: skip if squash detection is disabled
	if (process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1') {
		if (options.isShallow === true) {
			return {
				merged: false,
				commitsAhead: -1,
				commitsBehind: -1,
				detectionError: 'shallow clone: detection unavailable',
			}
		}
	}

	const shallowWarning =
		process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1' &&
		options.isShallow === null
			? 'shallow check failed: proceeding with detection'
			: undefined

	// Resolve target branch if not provided
	const target = targetBranch ?? (await getMainBranch(gitRoot))

	// Fully qualified refs
	const branchRef = toLocalBranchRef(branch)
	const targetRef = toTargetRef(target)

	// Layer 1: Ancestor check -- thread signal so subprocess terminates on abort
	const ancestorResult = await spawnAndCollect(
		['git', 'merge-base', '--is-ancestor', branchRef, targetRef],
		{ cwd: gitRoot, signal },
	)

	if (ancestorResult.exitCode === 0) {
		// Branch is an ancestor of target - standard merge or rebase
		const counts = await getAheadBehindCounts(
			gitRoot,
			branchRef,
			targetRef,
			signal,
		)
		return {
			merged: true,
			mergeMethod: 'ancestor',
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			...(shallowWarning ? { detectionError: shallowWarning } : {}),
		}
	}

	if (ancestorResult.exitCode >= 128) {
		// Fatal error (invalid ref, etc)
		return {
			merged: false,
			commitsAhead: 0,
			commitsBehind: 0,
			detectionError: `merge-base failed: ${ancestorResult.stderr.trim()}`,
		}
	}

	// Layer 2: Ahead/behind counts (always needed) -- thread signal
	const counts = await getAheadBehindCounts(
		gitRoot,
		branchRef,
		targetRef,
		signal,
	)

	// Layer 3: Squash detection (conditional)
	const shouldCheckSquash =
		process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1' &&
		counts.ahead <= maxCommitsForSquashDetection

	if (!shouldCheckSquash) {
		return {
			merged: false,
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			...(shallowWarning ? { detectionError: shallowWarning } : {}),
		}
	}

	// Find merge-base for synthetic commit parent -- thread signal
	const mergeBaseResult = await spawnAndCollect(
		['git', 'merge-base', branchRef, targetRef],
		{ cwd: gitRoot, signal },
	)

	if (mergeBaseResult.exitCode !== 0) {
		return {
			merged: false,
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			detectionError: `merge-base lookup failed: ${mergeBaseResult.stderr.trim()}`,
		}
	}

	const mergeBase = mergeBaseResult.stdout.trim()

	const objectEnvResult = await createIsolatedObjectEnv(gitRoot, signal)
	if ('detectionError' in objectEnvResult) {
		return {
			merged: false,
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			detectionError: objectEnvResult.detectionError,
		}
	}

	const { env: objectEnv, cleanup } = objectEnvResult
	try {
		// Create synthetic squash commit with merge-base as parent -- thread signal
		const commitTreeResult = await spawnAndCollect(
			[
				'git',
				'commit-tree',
				`${branchRef}^{tree}`,
				'-p',
				mergeBase,
				'-m',
				'squash detect',
			],
			{ cwd: gitRoot, env: objectEnv, signal },
		)

		if (commitTreeResult.exitCode !== 0) {
			return {
				merged: false,
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				detectionError: `commit-tree failed: ${commitTreeResult.stderr.trim()}`,
			}
		}

		const syntheticSha = commitTreeResult.stdout.trim()

		// Run cherry with timeout. Combine caller signal and local timeout so either
		// can terminate the subprocess -- whichever fires first wins.
		// We use spawnAndCollect directly so our composite signal isn't overwritten
		// (spawnWithTimeout creates its own internal AbortController and overwrites
		// the signal option, making it impossible to pass an external signal through).
		const cherrySignal = signal
			? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
			: AbortSignal.timeout(timeout)

		let cherryTimedOut = false
		let cherryRaw: { stdout: string; stderr: string; exitCode: number }
		try {
			cherryRaw = await spawnAndCollect(
				['git', 'cherry', targetRef, syntheticSha],
				{ cwd: gitRoot, env: objectEnv, signal: cherrySignal },
			)
		} catch {
			// AbortError from cherrySignal (timeout or external abort)
			cherryTimedOut = true
			cherryRaw = { stdout: '', stderr: '', exitCode: -1 }
		}

		const cherryResult = { ...cherryRaw, timedOut: cherryTimedOut }

		// Strict fail-closed validation
		if (
			cherryResult.timedOut ||
			cherryResult.exitCode !== 0 ||
			!cherryResult.stdout.trim()
		) {
			const reason = cherryResult.timedOut
				? 'timed out'
				: cherryResult.exitCode !== 0
					? `exit code ${cherryResult.exitCode}`
					: 'empty output'
			return {
				merged: false,
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				detectionError: `cherry ${reason}`,
			}
		}

		// Validate cherry output format
		const lines = cherryResult.stdout.trim().split('\n')
		const cherryLinePattern = /^[+-] [0-9a-f]{40}$/

		for (const line of lines) {
			if (!cherryLinePattern.test(line)) {
				return {
					merged: false,
					commitsAhead: counts.ahead,
					commitsBehind: counts.behind,
					detectionError: `cherry output invalid: ${line}`,
				}
			}
		}

		// Check if all commits are integrated (all lines start with '- ')
		const allIntegrated = lines.every((line) => line.startsWith('- '))

		if (allIntegrated) {
			return {
				merged: true,
				mergeMethod: 'squash',
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				...(shallowWarning ? { detectionError: shallowWarning } : {}),
			}
		}
	} finally {
		await cleanup()
	}

	return {
		merged: false,
		commitsAhead: counts.ahead,
		commitsBehind: counts.behind,
		...(shallowWarning ? { detectionError: shallowWarning } : {}),
	}
}

interface IsolatedObjectEnv {
	readonly env: Record<string, string>
	readonly cleanup: () => Promise<void>
}

/**
 * Normalize an input branch name to local branch ref syntax.
 *
 * Why: branch names can collide with tags, so `refs/heads/*` avoids ambiguity.
 */
function toLocalBranchRef(branch: string): string {
	if (branch.startsWith('refs/')) {
		return branch
	}
	return `refs/heads/${branch}`
}

/**
 * Normalize a target for merge checks while preserving symbolic refs.
 *
 * Why: `getMainBranch()` can resolve to `HEAD` in detached states.
 */
function toTargetRef(target: string): string {
	if (target === 'HEAD' || target.startsWith('refs/')) {
		return target
	}
	return `refs/heads/${target}`
}

/**
 * Create an isolated object store environment for synthetic commit detection.
 *
 * Why: `git commit-tree` writes object data; isolating keeps repo checks read-only.
 *
 * @param gitRoot - Absolute path to git repository root
 * @param signal - Optional AbortSignal to cancel the git-path subprocess
 */
async function createIsolatedObjectEnv(
	gitRoot: string,
	signal?: AbortSignal,
): Promise<IsolatedObjectEnv | { detectionError: string }> {
	const objectsPathResult = await spawnAndCollect(
		['git', 'rev-parse', '--git-path', 'objects'],
		{ cwd: gitRoot, signal },
	)

	if (objectsPathResult.exitCode !== 0) {
		return {
			detectionError: `git-path objects failed: ${objectsPathResult.stderr.trim()}`,
		}
	}

	const objectsPath = objectsPathResult.stdout.trim()
	if (!objectsPath) {
		return {
			detectionError: 'git-path objects returned empty path',
		}
	}

	const objectsDir = path.isAbsolute(objectsPath)
		? objectsPath
		: path.join(gitRoot, objectsPath)
	const isolatedDir = await mkdtemp(
		path.join(tmpdir(), `sq-git-objects-${process.pid}-`),
	)

	const existingAlternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES
	const alternateDirs = [
		objectsDir,
		...(existingAlternates?.split(path.delimiter).filter(Boolean) ?? []),
	]

	return {
		env: {
			GIT_OBJECT_DIRECTORY: isolatedDir,
			GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateDirs.join(path.delimiter),
		},
		cleanup: async () => {
			await rm(isolatedDir, { recursive: true, force: true })
		},
	}
}

/**
 * Get ahead/behind commit counts between two refs.
 *
 * @param gitRoot - Absolute path to git repository root
 * @param branchRef - Fully qualified branch ref
 * @param targetRef - Fully qualified target ref
 * @param signal - Optional AbortSignal to cancel the git subprocess
 * @returns Ahead and behind commit counts
 */
async function getAheadBehindCounts(
	gitRoot: string,
	branchRef: string,
	targetRef: string,
	signal?: AbortSignal,
): Promise<{ ahead: number; behind: number }> {
	const countResult = await spawnAndCollect(
		[
			'git',
			'rev-list',
			'--count',
			'--left-right',
			`${branchRef}...${targetRef}`,
		],
		{ cwd: gitRoot, signal },
	)

	if (countResult.exitCode !== 0) {
		return { ahead: 0, behind: 0 }
	}

	const parts = countResult.stdout.trim().split('\t')
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return { ahead: 0, behind: 0 }
	}

	const ahead = Number.parseInt(parts[0], 10)
	const behind = Number.parseInt(parts[1], 10)

	return {
		ahead: Number.isNaN(ahead) ? 0 : ahead,
		behind: Number.isNaN(behind) ? 0 : behind,
	}
}
