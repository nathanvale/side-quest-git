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
import { debugLog } from './debug.js'
import {
	createDetectionIssue,
	DETECTION_CODES,
	type DetectionIssue,
} from './detection-issue.js'
import { parseEnvInt } from './env.js'
import { getAheadBehindCounts } from './git-counts.js'
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
					} catch (err) {
						// EPERM: process exists but we lack permission -- it's alive.
						// ESRCH: process not found -- definitely stale.
						// All other errors: treat as stale (safe default).
						const code = (err as NodeJS.ErrnoException).code
						if (code === 'EPERM') {
							// Process is alive; still check age as secondary guard
							try {
								const stat = statSync(fullPath)
								isStale = now - stat.mtimeMs > oneHourMs
							} catch {
								isStale = true
							}
						} else {
							// ESRCH or unknown error: treat as stale
							isStale = true
						}
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
	/**
	 * Human-readable error/warning message.
	 *
	 * @deprecated Prefer `issues` for structured access. This field is computed
	 * from the first error-severity issue, or the first issue of any severity.
	 */
	readonly detectionError?: string
	/** Structured detection issues from the merge detection cascade. */
	readonly issues?: readonly DetectionIssue[]
}

/** Options for merge detection. */
export interface DetectionOptions {
	readonly timeout?: number
	readonly maxCommitsForSquashDetection?: number
	/** Pre-computed shallow clone status. true = shallow, false = not shallow, null = check failed. */
	readonly isShallow?: boolean | null
	/**
	 * Skip the shallow clone guard and proceed with detection anyway.
	 *
	 * Why: CI environments commonly use shallow clones (e.g. `actions/checkout`
	 * with `fetch-depth: 1`). When the user knows their clone depth is
	 * sufficient for the branches they care about they can set this flag (or
	 * the `SIDE_QUEST_SHALLOW_OK=1` env var) to bypass the early-exit guard
	 * and accept responsibility for any inaccuracies caused by missing history.
	 *
	 * Precedence: options.shallowOk > SIDE_QUEST_SHALLOW_OK env var > false
	 */
	readonly shallowOk?: boolean
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
 * Derive the backward-compatible `detectionError` string from an issues array.
 *
 * Why: The legacy field is computed from the first error-severity issue message,
 * or the first issue of any severity if none are errors. This preserves the
 * existing contract while letting callers migrate to structured issues.
 *
 * @param issues - Structured detection issues array
 * @returns The human-readable error string, or undefined if no issues
 */
function issuesToDetectionError(
	issues: readonly DetectionIssue[],
): string | undefined {
	if (issues.length === 0) return undefined
	return (
		issues.find((i) => i.severity === 'error')?.message ?? issues[0]!.message
	)
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
		const issues: readonly DetectionIssue[] = [
			createDetectionIssue(
				DETECTION_CODES.DETECTION_DISABLED,
				'warning',
				'kill-switch',
				'detection disabled',
				false,
			),
		]
		return {
			merged: false,
			commitsAhead: -1,
			commitsBehind: -1,
			detectionError: issuesToDetectionError(issues),
			issues,
		}
	}

	const defaultTimeoutMs = 5000
	const timeout =
		options.timeout ??
		parseEnvInt('SIDE_QUEST_DETECTION_TIMEOUT_MS', defaultTimeoutMs, {
			min: 1,
		})
	const maxCommitsForSquashDetection =
		options.maxCommitsForSquashDetection ?? 50
	const signal = options.signal

	// Early-exit if the caller's signal is already aborted before any git work.
	// This prevents spawning subprocesses that would be immediately killed.
	if (signal?.aborted) {
		const issues: readonly DetectionIssue[] = [
			createDetectionIssue(
				DETECTION_CODES.CHERRY_TIMEOUT,
				'warning',
				'layer3-cherry',
				'detection aborted',
				false,
			),
		]
		return {
			merged: false,
			commitsAhead: -1,
			commitsBehind: -1,
			detectionError: issuesToDetectionError(issues),
			issues,
		}
	}

	// Resolve shallowOk: options.shallowOk takes precedence, then env var.
	const shallowOk =
		options.shallowOk === true || process.env.SIDE_QUEST_SHALLOW_OK === '1'

	// Shallow clone guard: skip if squash detection is disabled OR shallowOk is set.
	// When shallowOk is true the user accepts responsibility for clone depth
	// being sufficient; we proceed without blocking.
	if (process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1' && !shallowOk) {
		if (options.isShallow === true) {
			const issues: readonly DetectionIssue[] = [
				createDetectionIssue(
					DETECTION_CODES.SHALLOW_CLONE,
					'error',
					'shallow-guard',
					'shallow clone: detection unavailable',
					false,
				),
			]
			return {
				merged: false,
				commitsAhead: -1,
				commitsBehind: -1,
				detectionError: issuesToDetectionError(issues),
				issues,
			}
		}
	}

	// Build up a mutable issues array as detection proceeds
	const issues: DetectionIssue[] = []

	// Shallow-check-failed warning: proceeds with detection but sets a warning.
	// Suppressed when shallowOk is set -- user opted in to proceed regardless.
	if (
		process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1' &&
		!shallowOk &&
		options.isShallow === null
	) {
		issues.push(
			createDetectionIssue(
				DETECTION_CODES.SHALLOW_CHECK_FAILED,
				'warning',
				'shallow-guard',
				'shallow check failed: proceeding with detection',
				true,
			),
		)
	}

	// Resolve target branch if not provided.
	// Wrapped in a top-level try/catch so that AbortErrors thrown by
	// spawnAndCollect in Layer 1 or Layer 2 (when the caller's signal fires)
	// produce a graceful return rather than an unhandled exception.
	// The inner Layer 3 try/catch remains as a nested handler for cherry.
	try {
		const target = targetBranch ?? (await getMainBranch(gitRoot))

		// Fully qualified refs
		const branchRef = toLocalBranchRef(branch)
		const targetRef = toTargetRef(target)

		const detectionStart = Date.now()
		debugLog('detection:start', {
			branch,
			target,
			timeout,
			maxCommitsForSquashDetection,
			shallowOk,
			isShallow: options.isShallow,
		})

		// Layer 1: Ancestor check -- thread signal so subprocess terminates on abort
		const layer1Start = Date.now()
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
			const layer1Duration = Date.now() - layer1Start
			debugLog('layer1:result', {
				branch,
				merged: true,
				mergeBase: 'ancestor',
				durationMs: layer1Duration,
			})
			const result: MergeDetectionResult = {
				merged: true,
				mergeMethod: 'ancestor',
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				...(issues.length > 0
					? {
							detectionError: issuesToDetectionError(issues),
							issues: issues as readonly DetectionIssue[],
						}
					: {}),
			}
			debugLog('detection:complete', {
				branch,
				merged: result.merged,
				mergeMethod: result.mergeMethod,
				commitsAhead: result.commitsAhead,
				commitsBehind: result.commitsBehind,
				totalDurationMs: Date.now() - detectionStart,
				issueCount: issues.length,
			})
			return result
		}

		if (ancestorResult.exitCode >= 128) {
			// Fatal error (invalid ref, etc)
			const errorMsg = `merge-base failed: ${ancestorResult.stderr.trim()}`
			issues.push(
				createDetectionIssue(
					DETECTION_CODES.MERGE_BASE_FAILED,
					'error',
					'layer1',
					errorMsg,
					false,
				),
			)
			const layer1Duration = Date.now() - layer1Start
			debugLog('layer1:result', {
				branch,
				merged: false,
				error: errorMsg,
				durationMs: layer1Duration,
			})
			const result: MergeDetectionResult = {
				merged: false,
				commitsAhead: 0,
				commitsBehind: 0,
				detectionError: issuesToDetectionError(issues),
				issues: issues as readonly DetectionIssue[],
			}
			debugLog('detection:complete', {
				branch,
				merged: result.merged,
				totalDurationMs: Date.now() - detectionStart,
				issueCount: issues.length,
			})
			return result
		}

		const layer1Duration = Date.now() - layer1Start
		debugLog('layer1:result', {
			branch,
			merged: false,
			mergeBase: 'not-ancestor',
			durationMs: layer1Duration,
		})

		// Layer 2: Ahead/behind counts (always needed) -- thread signal
		const layer2Start = Date.now()
		const counts = await getAheadBehindCounts(
			gitRoot,
			branchRef,
			targetRef,
			signal,
		)
		const layer2Duration = Date.now() - layer2Start
		debugLog('layer2:result', {
			branch,
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			durationMs: layer2Duration,
		})

		// Layer 3: Squash detection (conditional)
		const shouldCheckSquash =
			process.env.SIDE_QUEST_NO_SQUASH_DETECTION !== '1' &&
			counts.ahead <= maxCommitsForSquashDetection

		if (!shouldCheckSquash) {
			// Note: when NO_SQUASH_DETECTION=1, squash detection is silently skipped.
			// We do NOT add a detectionError here (backward compat: existing callers
			// rely on detectionError being undefined for the squash-skip path).
			// The issues array may contain earlier warnings (e.g. shallow-check-failed).
			const result: MergeDetectionResult = {
				merged: false,
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				...(issues.length > 0
					? {
							detectionError: issuesToDetectionError(issues),
							issues: issues as readonly DetectionIssue[],
						}
					: {}),
			}
			debugLog('detection:complete', {
				branch,
				merged: result.merged,
				commitsAhead: result.commitsAhead,
				commitsBehind: result.commitsBehind,
				totalDurationMs: Date.now() - detectionStart,
				issueCount: issues.length,
			})
			return result
		}

		// Find merge-base for synthetic commit parent -- thread signal
		const mergeBaseResult = await spawnAndCollect(
			['git', 'merge-base', branchRef, targetRef],
			{ cwd: gitRoot, signal },
		)

		if (mergeBaseResult.exitCode !== 0) {
			const errorMsg = `merge-base lookup failed: ${mergeBaseResult.stderr.trim()}`
			issues.push(
				createDetectionIssue(
					DETECTION_CODES.MERGE_BASE_LOOKUP_FAILED,
					'warning',
					'layer2',
					errorMsg,
					true,
				),
			)
			const result: MergeDetectionResult = {
				merged: false,
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				detectionError: issuesToDetectionError(issues),
				issues: issues as readonly DetectionIssue[],
			}
			debugLog('detection:complete', {
				branch,
				merged: result.merged,
				totalDurationMs: Date.now() - detectionStart,
				issueCount: issues.length,
			})
			return result
		}

		const mergeBase = mergeBaseResult.stdout.trim()

		debugLog('layer3:start', { branch, target, timeout })

		const objectEnvResult = await createIsolatedObjectEnv(gitRoot, signal)
		if ('detectionError' in objectEnvResult) {
			issues.push(
				createDetectionIssue(
					DETECTION_CODES.GIT_PATH_FAILED,
					'warning',
					'layer3-cherry',
					objectEnvResult.detectionError,
					true,
				),
			)
			const result: MergeDetectionResult = {
				merged: false,
				commitsAhead: counts.ahead,
				commitsBehind: counts.behind,
				detectionError: issuesToDetectionError(issues),
				issues: issues as readonly DetectionIssue[],
			}
			debugLog('detection:complete', {
				branch,
				merged: result.merged,
				totalDurationMs: Date.now() - detectionStart,
				issueCount: issues.length,
			})
			return result
		}

		const { env: objectEnv, cleanup } = objectEnvResult
		const layer3Start = Date.now()
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
				const errorMsg = `commit-tree failed: ${commitTreeResult.stderr.trim()}`
				issues.push(
					createDetectionIssue(
						DETECTION_CODES.COMMIT_TREE_FAILED,
						'warning',
						'layer3-commit-tree',
						errorMsg,
						true,
					),
				)
				const result: MergeDetectionResult = {
					merged: false,
					commitsAhead: counts.ahead,
					commitsBehind: counts.behind,
					detectionError: issuesToDetectionError(issues),
					issues: issues as readonly DetectionIssue[],
				}
				debugLog('detection:complete', {
					branch,
					merged: result.merged,
					totalDurationMs: Date.now() - detectionStart,
					issueCount: issues.length,
				})
				return result
			}

			const syntheticSha = commitTreeResult.stdout.trim()

			// Run cherry with timeout. Combine caller signal and local timeout so either
			// can terminate the subprocess -- whichever fires first wins.
			// We use spawnAndCollect directly so our composite signal isn't overwritten
			// (spawnWithTimeout creates its own internal AbortController and overwrites
			// the signal option, making it impossible to pass an external signal through).
			//
			// Why no batching across branches (issue #25):
			// `git cherry` accepts exactly one upstream..head pair per invocation --
			// there is no multi-branch mode. The only potentially batchable step is
			// `git rev-parse --git-path objects` (the isolated object env setup above),
			// which saves ~10ms per group. Against a per-branch total of ~60ms this
			// is <17% -- within noise. `processInParallelChunks` already parallelizes
			// across branches, so wall time scales with concurrency, not branch count.
			// Full investigation: src/worktree/benchmarks/cherry-investigation.ts
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
			const layer3Duration = Date.now() - layer3Start

			// Strict fail-closed validation
			if (
				cherryResult.timedOut ||
				cherryResult.exitCode !== 0 ||
				!cherryResult.stdout.trim()
			) {
				let cherryCode: string
				let cherryMsg: string

				if (cherryResult.timedOut) {
					// Distinguish between abort from external signal vs local timeout
					const isAbort = signal?.aborted
					cherryCode = DETECTION_CODES.CHERRY_TIMEOUT
					cherryMsg = isAbort
						? `cherry aborted: ${signal?.reason ?? 'signal aborted'}`
						: 'cherry timed out'
				} else if (cherryResult.exitCode !== 0) {
					cherryCode = DETECTION_CODES.CHERRY_FAILED
					cherryMsg = `cherry exit code ${cherryResult.exitCode}`
				} else {
					cherryCode = DETECTION_CODES.CHERRY_EMPTY
					cherryMsg = 'cherry empty output'
				}

				issues.push(
					createDetectionIssue(
						cherryCode,
						'warning',
						'layer3-cherry',
						cherryMsg,
						true,
					),
				)
				debugLog('layer3:result', {
					branch,
					squashDetected: false,
					durationMs: layer3Duration,
					exitCode: cherryResult.exitCode,
					timedOut: cherryResult.timedOut,
				})
				const result: MergeDetectionResult = {
					merged: false,
					commitsAhead: counts.ahead,
					commitsBehind: counts.behind,
					detectionError: issuesToDetectionError(issues),
					issues: issues as readonly DetectionIssue[],
				}
				debugLog('detection:complete', {
					branch,
					merged: result.merged,
					totalDurationMs: Date.now() - detectionStart,
					issueCount: issues.length,
				})
				return result
			}

			// Validate cherry output format
			const lines = cherryResult.stdout.trim().split('\n')
			const cherryLinePattern = /^[+-] [0-9a-f]{40}$/

			for (const line of lines) {
				if (!cherryLinePattern.test(line)) {
					const errorMsg = `cherry output invalid: ${line}`
					issues.push(
						createDetectionIssue(
							DETECTION_CODES.CHERRY_INVALID,
							'warning',
							'layer3-cherry',
							errorMsg,
							true,
						),
					)
					debugLog('layer3:result', {
						branch,
						squashDetected: false,
						durationMs: Date.now() - layer3Start,
						exitCode: cherryResult.exitCode,
						error: errorMsg,
					})
					const result: MergeDetectionResult = {
						merged: false,
						commitsAhead: counts.ahead,
						commitsBehind: counts.behind,
						detectionError: issuesToDetectionError(issues),
						issues: issues as readonly DetectionIssue[],
					}
					debugLog('detection:complete', {
						branch,
						merged: result.merged,
						totalDurationMs: Date.now() - detectionStart,
						issueCount: issues.length,
					})
					return result
				}
			}

			// Check if all commits are integrated (all lines start with '- ')
			const allIntegrated = lines.every((line) => line.startsWith('- '))

			debugLog('layer3:result', {
				branch,
				squashDetected: allIntegrated,
				durationMs: layer3Duration,
				exitCode: cherryResult.exitCode,
			})

			if (allIntegrated) {
				const result: MergeDetectionResult = {
					merged: true,
					mergeMethod: 'squash',
					commitsAhead: counts.ahead,
					commitsBehind: counts.behind,
					...(issues.length > 0
						? {
								detectionError: issuesToDetectionError(issues),
								issues: issues as readonly DetectionIssue[],
							}
						: {}),
				}
				debugLog('detection:complete', {
					branch,
					merged: result.merged,
					mergeMethod: result.mergeMethod,
					commitsAhead: result.commitsAhead,
					commitsBehind: result.commitsBehind,
					totalDurationMs: Date.now() - detectionStart,
					issueCount: issues.length,
				})
				return result
			}
		} finally {
			await cleanup()
		}

		const result: MergeDetectionResult = {
			merged: false,
			commitsAhead: counts.ahead,
			commitsBehind: counts.behind,
			...(issues.length > 0
				? {
						detectionError: issuesToDetectionError(issues),
						issues: issues as readonly DetectionIssue[],
					}
				: {}),
		}
		debugLog('detection:complete', {
			branch,
			merged: result.merged,
			commitsAhead: result.commitsAhead,
			commitsBehind: result.commitsBehind,
			totalDurationMs: Date.now() - detectionStart,
			issueCount: issues.length,
		})
		return result
	} catch (err) {
		// AbortError from Layer 1 or Layer 2 subprocess: signal fired before the
		// git subprocess completed. Convert to a graceful result instead of
		// letting the exception propagate as an unhandled rejection.
		// Layer 3 abort is handled by its own inner try/catch.
		if (err instanceof Error && err.name === 'AbortError') {
			const abortIssues: readonly DetectionIssue[] = [
				createDetectionIssue(
					DETECTION_CODES.DETECTION_ABORTED,
					'error',
					'layer1-layer2',
					`detection aborted: ${err.message}`,
					false,
				),
			]
			return {
				merged: false,
				commitsAhead: -1,
				commitsBehind: -1,
				detectionError: issuesToDetectionError(abortIssues),
				issues: abortIssues,
			}
		}
		throw err
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
