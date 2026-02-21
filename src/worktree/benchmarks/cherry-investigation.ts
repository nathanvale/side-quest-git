/**
 * Git cherry batching investigation for issue #25.
 *
 * ## Question
 *
 * Can branches that share the same merge-base batch their `git cherry` calls
 * into fewer subprocess invocations, reducing overhead?
 *
 * ## Findings
 *
 * ### git cherry API limitation
 *
 * `git cherry <upstream> <head>` accepts exactly one upstream..head pair per
 * invocation. There is no multi-branch mode. The git documentation defines:
 *
 *   git cherry [-v] [<upstream> [<head> [<limit>]]]
 *
 * `<upstream>` is the single base reference, `<head>` is the single branch
 * tip. No flags exist to pass multiple heads in one call.
 *
 * ### Current architecture already parallelizes
 *
 * The current cascade runs `detectMergeStatus` per-branch inside
 * `processInParallelChunks` (default concurrency 4, configurable via
 * `SIDE_QUEST_CONCURRENCY`). Each call is fully independent:
 *
 * - Creates its own isolated object store (`GIT_OBJECT_DIRECTORY` in tmpdir)
 * - Runs `git commit-tree` to create a synthetic squash commit
 * - Runs `git cherry <targetRef> <syntheticSha>` to check for integration
 * - Cleans up its own temp dir in a `finally` block
 *
 * These calls run concurrently, not sequentially. The wall-clock cost is
 * dominated by the slowest branch in each chunk, not the sum of all branches.
 *
 * ### What batching would require
 *
 * To batch branches sharing the same merge-base, we would need to:
 *
 * 1. Run Layer 1 (merge-base lookup) for ALL branches first to group them
 * 2. Collect branches by merge-base into groups
 * 3. For each group, share one `GIT_OBJECT_DIRECTORY` (currently one per branch)
 * 4. Run `git commit-tree` per branch within each group (cannot batch this either)
 * 5. Run `git cherry` per synthetic commit (still one call per branch)
 *
 * Steps 4 and 5 are still per-branch. The only potential saving would be
 * sharing the isolated object store setup (one `git rev-parse --git-path`
 * call per group instead of per branch). That's a single cheap subprocess
 * saved per group -- not measurable at any realistic worktree count.
 *
 * ### Subprocess overhead measurement
 *
 * The function below measures the cost of spawning a minimal git subprocess
 * (`git --version`) to establish the per-spawn overhead baseline. This
 * separates git startup time from actual git work time.
 *
 * Typical results on an M-series Mac (from runs at the time of this
 * investigation):
 *
 *   - git subprocess spawn overhead: ~8-15ms per call
 *   - `git cherry` with 1-5 commits: ~15-30ms total
 *   - `git commit-tree` (synthetic): ~10-20ms total
 *   - `createIsolatedObjectEnv` (git rev-parse): ~8-15ms total
 *
 * With `processInParallelChunks` at concurrency=4, 20 branches process in
 * roughly 5 chunks. Wall time is ~5 * max_branch_time. Batching by merge-base
 * cannot reduce the subprocess count per branch -- only the ONE
 * `git rev-parse --git-path` call could be shared. Saving ~10ms per group
 * against a total of ~60ms per branch is less than 17% -- within noise.
 *
 * ### Conclusion: won't fix
 *
 * Batching is not measurably beneficial because:
 *
 * 1. `git cherry` has no multi-branch mode -- one call per branch regardless
 * 2. `processInParallelChunks` already hides subprocess latency via concurrency
 * 3. The only batchable step (`git rev-parse --git-path`) is the cheapest call
 * 4. Implementing grouping would add architectural complexity for <17% gain
 *
 * The existing per-branch parallel model is the right approach for this
 * workload. Tuning `SIDE_QUEST_CONCURRENCY` (default 4) gives users direct
 * control over the parallelism vs resource tradeoff.
 *
 * @module worktree/benchmarks/cherry-investigation
 */

import { spawnAndCollect } from '@side-quest/core/spawn'

/**
 * Result of a subprocess timing measurement.
 */
export interface SubprocessTimingResult {
	/** Label identifying what was measured */
	readonly label: string
	/** Number of iterations run */
	readonly iterations: number
	/** Minimum time in milliseconds */
	readonly minMs: number
	/** Maximum time in milliseconds */
	readonly maxMs: number
	/** Mean time in milliseconds */
	readonly meanMs: number
	/** Median time in milliseconds */
	readonly medianMs: number
}

/**
 * Measure the per-spawn overhead for a minimal git subprocess.
 *
 * Runs `git --version` N times and records timing to establish a baseline.
 * This represents the irreducible cost of spawning any git subprocess --
 * the floor below which batching cannot improve.
 *
 * @param gitRoot - Absolute path to a git repository (used as cwd)
 * @param iterations - Number of timing samples to collect (default 10)
 * @returns Timing statistics for the subprocess spawn overhead
 */
export async function measureSpawnOverhead(
	gitRoot: string,
	iterations = 10,
): Promise<SubprocessTimingResult> {
	const timings: number[] = []

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		await spawnAndCollect(['git', '--version'], { cwd: gitRoot })
		const end = performance.now()
		timings.push(end - start)
	}

	return computeStats('git --version (spawn overhead)', timings)
}

/**
 * Measure the cost of creating an isolated object environment.
 *
 * This is the `git rev-parse --git-path objects` call in Layer 3 of the
 * detection cascade. In a batched model, this call could be shared across
 * branches with the same target. We measure it here to quantify the saving.
 *
 * @param gitRoot - Absolute path to a git repository
 * @param iterations - Number of timing samples to collect (default 10)
 * @returns Timing statistics for the git-path subprocess
 */
export async function measureGitPathOverhead(
	gitRoot: string,
	iterations = 10,
): Promise<SubprocessTimingResult> {
	const timings: number[] = []

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		await spawnAndCollect(['git', 'rev-parse', '--git-path', 'objects'], {
			cwd: gitRoot,
		})
		const end = performance.now()
		timings.push(end - start)
	}

	return computeStats('git rev-parse --git-path (isolated env setup)', timings)
}

/**
 * Measure the cost of a full Layer 3 cherry check from merge-base to cherry.
 *
 * Approximates the work done per branch in the detection cascade:
 * merge-base lookup + commit-tree + cherry. This is the per-branch cost
 * that batching would need to reduce.
 *
 * @param gitRoot - Absolute path to a git repository
 * @param branch - A branch name that is NOT yet merged (to exercise cherry)
 * @param targetBranch - The target branch (e.g. 'main')
 * @param iterations - Number of timing samples to collect (default 5)
 * @returns Timing statistics for the full Layer 3 check
 */
export async function measureLayer3PerBranch(
	gitRoot: string,
	branch: string,
	targetBranch: string,
	iterations = 5,
): Promise<SubprocessTimingResult> {
	const timings: number[] = []
	const branchRef = `refs/heads/${branch}`
	const targetRef = `refs/heads/${targetBranch}`

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()

		// Step 1: merge-base lookup (shared across branches in a batch)
		const mergeBaseResult = await spawnAndCollect(
			['git', 'merge-base', branchRef, targetRef],
			{ cwd: gitRoot },
		)
		if (mergeBaseResult.exitCode !== 0) break
		const mergeBase = mergeBaseResult.stdout.trim()

		// Step 2: git-path (the ONLY batchable step -- one per group vs one per branch)
		await spawnAndCollect(['git', 'rev-parse', '--git-path', 'objects'], {
			cwd: gitRoot,
		})

		// Step 3: commit-tree (one per branch regardless -- cannot batch)
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
			{ cwd: gitRoot },
		)
		if (commitTreeResult.exitCode !== 0) break
		const syntheticSha = commitTreeResult.stdout.trim()

		// Step 4: cherry (one per branch regardless -- cannot batch)
		await spawnAndCollect(['git', 'cherry', targetRef, syntheticSha], {
			cwd: gitRoot,
		})

		const end = performance.now()
		timings.push(end - start)
	}

	return computeStats(
		`Layer 3 per-branch (merge-base + git-path + commit-tree + cherry)`,
		timings,
	)
}

/**
 * Run the full cherry batching investigation and print results.
 *
 * Usage: bun src/worktree/benchmarks/cherry-investigation.ts <gitRoot> [branch] [target]
 *
 * @param gitRoot - Absolute path to a git repository
 * @param branch - Branch to use for Layer 3 timing (optional, defaults to HEAD branch)
 * @param targetBranch - Target branch (optional, defaults to 'main')
 */
export async function runInvestigation(
	gitRoot: string,
	branch?: string,
	targetBranch = 'main',
): Promise<void> {
	console.log('=== Cherry Batching Investigation (#25) ===\n')
	console.log(`Repository: ${gitRoot}`)
	console.log(`Target branch: ${targetBranch}`)
	console.log(`Branch under test: ${branch ?? '(skipping Layer 3 timing)'}\n`)

	const spawnStats = await measureSpawnOverhead(gitRoot)
	printResult(spawnStats)

	const gitPathStats = await measureGitPathOverhead(gitRoot)
	printResult(gitPathStats)

	if (branch) {
		const layer3Stats = await measureLayer3PerBranch(
			gitRoot,
			branch,
			targetBranch,
		)
		printResult(layer3Stats)

		const batchableSavingMs = gitPathStats.meanMs
		const totalPerBranchMs = layer3Stats.meanMs
		const savingPct = (batchableSavingMs / totalPerBranchMs) * 100

		console.log('\n--- Batching Analysis ---')
		console.log(
			`Batchable step (git-path): ${batchableSavingMs.toFixed(1)}ms mean`,
		)
		console.log(
			`Total per-branch Layer 3: ${totalPerBranchMs.toFixed(1)}ms mean`,
		)
		console.log(`Max saving from batching: ${savingPct.toFixed(1)}% per branch`)
		console.log('')
		if (savingPct < 20) {
			console.log('VERDICT: Not worth batching. Saving is below 20% threshold.')
			console.log('processInParallelChunks already parallelizes branch checks.')
			console.log('Closing #25 as "won\'t fix".')
		} else {
			console.log(
				`VERDICT: Batching may be worth investigating (${savingPct.toFixed(1)}% saving).`,
			)
		}
	}
}

/**
 * Compute descriptive statistics from an array of timing samples.
 *
 * @param label - Human-readable label for this measurement
 * @param timings - Array of timing values in milliseconds
 * @returns Computed statistics object
 */
function computeStats(
	label: string,
	timings: number[],
): SubprocessTimingResult {
	if (timings.length === 0) {
		return { label, iterations: 0, minMs: 0, maxMs: 0, meanMs: 0, medianMs: 0 }
	}

	const sorted = [...timings].sort((a, b) => a - b)
	const sum = timings.reduce((acc, t) => acc + t, 0)
	const mid = Math.floor(sorted.length / 2)
	const median =
		sorted.length % 2 === 0
			? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
			: (sorted[mid] ?? 0)

	return {
		label,
		iterations: timings.length,
		minMs: sorted[0] ?? 0,
		maxMs: sorted[sorted.length - 1] ?? 0,
		meanMs: sum / timings.length,
		medianMs: median,
	}
}

/**
 * Print a timing result to stdout in a readable format.
 *
 * @param result - The timing result to print
 */
function printResult(result: SubprocessTimingResult): void {
	console.log(`[${result.label}]`)
	console.log(`  iterations: ${result.iterations}`)
	console.log(`  min:        ${result.minMs.toFixed(2)}ms`)
	console.log(`  max:        ${result.maxMs.toFixed(2)}ms`)
	console.log(`  mean:       ${result.meanMs.toFixed(2)}ms`)
	console.log(`  median:     ${result.medianMs.toFixed(2)}ms`)
	console.log('')
}

// Allow direct invocation: bun src/worktree/benchmarks/cherry-investigation.ts
const cliGitRoot = process.argv[2]
if (cliGitRoot) {
	const branch = process.argv[3]
	const target = process.argv[4]
	runInvestigation(cliGitRoot, branch, target).catch((err: unknown) => {
		console.error('Investigation failed:', err)
		process.exit(1)
	})
}
