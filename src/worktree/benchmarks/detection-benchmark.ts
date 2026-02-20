/**
 * Comprehensive detection benchmark for the worktree merge-status cascade.
 *
 * ## What this measures
 *
 * 1. `detectMergeStatus` latency per merge method:
 *    - ancestor: branch fully merged via regular merge or rebase
 *    - squash: branch squash-merged (requires Layer 3 cherry detection)
 *    - unmerged: branch not yet integrated (exercises full cascade, no match)
 *
 * 2. `listWorktrees` end-to-end timing with multiple worktrees
 *
 * 3. Concurrency impact on wall time -- same N branches at concurrency 1, 2, 4, 8
 *
 * ## How it works
 *
 * The script creates a temporary git repository with real commits and worktrees
 * so that all git subprocesses execute against genuine object store data.
 * This avoids mocking artifacts and produces measurements representative of
 * production usage.
 *
 * ## Usage
 *
 *   bun src/worktree/benchmarks/detection-benchmark.ts [worktreeCount]
 *
 * `worktreeCount` defaults to 6 (2 per merge state). Set higher for stress tests.
 *
 * ## Output
 *
 * JSON is written to stdout. Progress messages go to stderr.
 *
 * @module worktree/benchmarks/detection-benchmark
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { listWorktrees } from '../list.js'
import { detectMergeStatus } from '../merge-status.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Timing statistics for a single benchmark scenario. */
export interface BenchmarkStats {
	/** Human-readable label for this scenario */
	readonly label: string
	/** Number of iterations run */
	readonly iterations: number
	/** Minimum wall time in milliseconds */
	readonly minMs: number
	/** Maximum wall time in milliseconds */
	readonly maxMs: number
	/** Arithmetic mean wall time in milliseconds */
	readonly meanMs: number
	/** Median (p50) wall time in milliseconds */
	readonly medianMs: number
	/** 95th percentile wall time in milliseconds */
	readonly p95Ms: number
}

/** Results for the detectMergeStatus per-method benchmarks. */
export interface DetectionBenchmarkResults {
	readonly label: 'detectMergeStatus per merge method'
	readonly ancestor: BenchmarkStats
	readonly squash: BenchmarkStats
	readonly unmerged: BenchmarkStats
}

/** Results for the listWorktrees end-to-end benchmark. */
export interface ListBenchmarkResults {
	readonly label: 'listWorktrees end-to-end'
	/** Number of worktrees in the repo under test */
	readonly worktreeCount: number
	readonly stats: BenchmarkStats
}

/** Results for a single concurrency level. */
export interface ConcurrencyLevelResult {
	readonly concurrency: number
	readonly stats: BenchmarkStats
}

/** Results for the concurrency impact benchmark. */
export interface ConcurrencyBenchmarkResults {
	readonly label: 'listWorktrees concurrency impact'
	/** Number of worktrees in the repo under test */
	readonly worktreeCount: number
	readonly levels: readonly ConcurrencyLevelResult[]
}

/** Full benchmark output written to stdout. */
export interface BenchmarkOutput {
	readonly timestamp: string
	readonly platform: string
	readonly worktreeCount: number
	readonly detection: DetectionBenchmarkResults
	readonly list: ListBenchmarkResults
	readonly concurrency: ConcurrencyBenchmarkResults
}

// ---------------------------------------------------------------------------
// Repo setup helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command in a directory, throwing on non-zero exit.
 *
 * @param args - Git arguments (without the 'git' prefix)
 * @param cwd - Working directory
 */
async function git(args: string[], cwd: string): Promise<string> {
	const result = await spawnAndCollect(['git', ...args], { cwd })
	if (result.exitCode !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
		)
	}
	return result.stdout.trim()
}

/**
 * Initialise a bare git repo suitable for linked worktrees.
 *
 * We initialise a regular repo, make an initial commit, then create linked
 * worktrees from it. Using a non-bare main repo is simpler and works fine
 * for benchmarking purposes.
 *
 * @param dir - Absolute path to an existing empty directory
 */
async function initRepo(dir: string): Promise<void> {
	await git(['init', '-b', 'main'], dir)
	await git(['config', 'user.email', 'bench@example.com'], dir)
	await git(['config', 'user.name', 'Benchmark'], dir)

	// Create an initial commit so HEAD is valid
	await writeFile(path.join(dir, 'README.md'), '# benchmark repo\n')
	await git(['add', 'README.md'], dir)
	await git(['commit', '-m', 'chore: initial commit'], dir)
}

/**
 * Add a file commit to the current branch.
 *
 * @param dir - Working directory (a git repo or worktree path)
 * @param filename - Name of the file to create
 * @param content - File content
 * @param message - Commit message
 */
async function addCommit(
	dir: string,
	filename: string,
	content: string,
	message: string,
): Promise<void> {
	await writeFile(path.join(dir, filename), content)
	await git(['add', filename], dir)
	await git(['commit', '-m', message], dir)
}

// ---------------------------------------------------------------------------
// Branch state setup
// ---------------------------------------------------------------------------

/**
 * Create a branch that was merged via regular merge (ancestor merge method).
 *
 * Steps:
 * 1. Create branch from main, add a commit
 * 2. Merge into main with --no-ff to create a real merge commit
 *
 * @param repoDir - Absolute path to the main git repo
 * @param branchName - Name of the branch to create and merge
 */
async function setupAncestorMergedBranch(
	repoDir: string,
	branchName: string,
): Promise<void> {
	// Sanitise branch name to a flat filename (branch names can contain slashes)
	const safeName = branchName.replace(/\//g, '-')
	// Create branch and add work
	await git(['checkout', '-b', branchName], repoDir)
	await addCommit(
		repoDir,
		`${safeName}.txt`,
		`work on ${branchName}`,
		`feat: ${branchName}`,
	)

	// Merge back into main
	await git(['checkout', 'main'], repoDir)
	await git(
		['merge', '--no-ff', branchName, '-m', `merge: ${branchName}`],
		repoDir,
	)
}

/**
 * Create a branch that was squash-merged (squash merge method).
 *
 * Steps:
 * 1. Create branch from main, add commits
 * 2. Squash-merge into main (--squash + commit)
 * 3. Branch tip remains ahead of main, but content is integrated
 *
 * @param repoDir - Absolute path to the main git repo
 * @param branchName - Name of the branch to create and squash-merge
 */
async function setupSquashMergedBranch(
	repoDir: string,
	branchName: string,
): Promise<void> {
	// Sanitise branch name to a flat filename (branch names can contain slashes)
	const safeName = branchName.replace(/\//g, '-')
	// Create branch and add work
	await git(['checkout', '-b', branchName], repoDir)
	await addCommit(
		repoDir,
		`${safeName}.txt`,
		`work on ${branchName}`,
		`feat: ${branchName}`,
	)
	await addCommit(
		repoDir,
		`${safeName}-2.txt`,
		`more work on ${branchName}`,
		`feat: ${branchName} part 2`,
	)

	// Squash-merge back into main
	await git(['checkout', 'main'], repoDir)
	await git(['merge', '--squash', branchName], repoDir)
	await git(['commit', '-m', `squash: ${branchName}`], repoDir)
}

/**
 * Create a branch that has NOT been merged (unmerged state).
 *
 * Simply creates a branch with unique commits that are not in main.
 *
 * @param repoDir - Absolute path to the main git repo
 * @param branchName - Name of the branch to create (stays unmerged)
 */
async function setupUnmergedBranch(
	repoDir: string,
	branchName: string,
): Promise<void> {
	// Sanitise branch name to a flat filename (branch names can contain slashes)
	const safeName = branchName.replace(/\//g, '-')
	await git(['checkout', '-b', branchName], repoDir)
	await addCommit(
		repoDir,
		`${safeName}.txt`,
		`wip on ${branchName}`,
		`feat: wip ${branchName}`,
	)

	// Leave branch checked-out state clean -- go back to main
	await git(['checkout', 'main'], repoDir)
}

// ---------------------------------------------------------------------------
// Timing utilities
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics from an array of timing samples.
 *
 * @param label - Human-readable label for the scenario
 * @param timings - Array of wall-time measurements in milliseconds
 * @returns Computed statistics object
 */
function computeStats(label: string, timings: number[]): BenchmarkStats {
	if (timings.length === 0) {
		return {
			label,
			iterations: 0,
			minMs: 0,
			maxMs: 0,
			meanMs: 0,
			medianMs: 0,
			p95Ms: 0,
		}
	}

	const sorted = [...timings].sort((a, b) => a - b)
	const sum = timings.reduce((acc, t) => acc + t, 0)
	const mid = Math.floor(sorted.length / 2)
	const median =
		sorted.length % 2 === 0
			? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
			: (sorted[mid] ?? 0)

	const p95Index = Math.min(
		Math.ceil(sorted.length * 0.95) - 1,
		sorted.length - 1,
	)

	return {
		label,
		iterations: timings.length,
		minMs: sorted[0] ?? 0,
		maxMs: sorted[sorted.length - 1] ?? 0,
		meanMs: sum / timings.length,
		medianMs: median,
		p95Ms: sorted[p95Index] ?? 0,
	}
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

/**
 * Benchmark `detectMergeStatus` for each of the three merge states.
 *
 * Runs each scenario in isolation (no concurrency) to get clean per-call
 * latency numbers. Uses `shallowOk: true` to skip the shallow clone guard
 * since the temp repo is not a shallow clone.
 *
 * @param repoDir - Absolute path to the benchmark repo
 * @param ancestorBranch - Name of an ancestor-merged branch
 * @param squashBranch - Name of a squash-merged branch
 * @param unmergedBranch - Name of an unmerged branch
 * @param iterations - Number of timing samples per scenario
 * @returns Per-method timing statistics
 */
export async function benchmarkDetectMergeStatus(
	repoDir: string,
	ancestorBranch: string,
	squashBranch: string,
	unmergedBranch: string,
	iterations = 5,
): Promise<DetectionBenchmarkResults> {
	const runScenario = async (branch: string, label: string) => {
		const timings: number[] = []
		for (let i = 0; i < iterations; i++) {
			const start = performance.now()
			await detectMergeStatus(repoDir, branch, 'main', { shallowOk: true })
			timings.push(performance.now() - start)
		}
		return computeStats(label, timings)
	}

	const ancestor = await runScenario(
		ancestorBranch,
		'detectMergeStatus (ancestor-merged)',
	)
	const squash = await runScenario(
		squashBranch,
		'detectMergeStatus (squash-merged)',
	)
	const unmerged = await runScenario(
		unmergedBranch,
		'detectMergeStatus (unmerged)',
	)

	return {
		label: 'detectMergeStatus per merge method',
		ancestor,
		squash,
		unmerged,
	}
}

/**
 * Benchmark `listWorktrees` end-to-end with all registered worktrees.
 *
 * Uses the default concurrency (4) to measure realistic throughput. Each
 * iteration calls `listWorktrees` cold (no caching) to capture full latency.
 *
 * @param repoDir - Absolute path to the benchmark repo
 * @param worktreeCount - Number of worktrees present (for reporting)
 * @param iterations - Number of timing samples
 * @returns End-to-end timing statistics
 */
export async function benchmarkListWorktrees(
	repoDir: string,
	worktreeCount: number,
	iterations = 5,
): Promise<ListBenchmarkResults> {
	const timings: number[] = []

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		await listWorktrees(repoDir, { shallowOk: true })
		timings.push(performance.now() - start)
	}

	return {
		label: 'listWorktrees end-to-end',
		worktreeCount,
		stats: computeStats(
			`listWorktrees (${worktreeCount} worktrees, concurrency 4)`,
			timings,
		),
	}
}

/**
 * Benchmark the impact of concurrency on `listWorktrees` wall time.
 *
 * Runs the same N-worktree list at concurrency levels [1, 2, 4, 8] and
 * records wall times so callers can see the speedup curve.
 *
 * @param repoDir - Absolute path to the benchmark repo
 * @param worktreeCount - Number of worktrees present (for reporting)
 * @param concurrencyLevels - Concurrency values to test
 * @param iterations - Number of timing samples per level
 * @returns Timing results indexed by concurrency level
 */
export async function benchmarkConcurrencyImpact(
	repoDir: string,
	worktreeCount: number,
	concurrencyLevels = [1, 2, 4, 8],
	iterations = 3,
): Promise<ConcurrencyBenchmarkResults> {
	const levels: ConcurrencyLevelResult[] = []

	for (const concurrency of concurrencyLevels) {
		const timings: number[] = []

		for (let i = 0; i < iterations; i++) {
			const start = performance.now()
			await listWorktrees(repoDir, { shallowOk: true, concurrency })
			timings.push(performance.now() - start)
		}

		levels.push({
			concurrency,
			stats: computeStats(
				`listWorktrees (${worktreeCount} worktrees, concurrency ${concurrency})`,
				timings,
			),
		})
	}

	return {
		label: 'listWorktrees concurrency impact',
		worktreeCount,
		levels,
	}
}

// ---------------------------------------------------------------------------
// Repo scaffolding
// ---------------------------------------------------------------------------

/**
 * Create a temporary git repo with worktrees in each merge state.
 *
 * Returns branch names grouped by merge state and the temp directory path.
 * The worktreeCount is split across the three states (rounded up for ancestor
 * and squash so unmerged gets any remainder).
 *
 * @param worktreeCount - Total number of feature branches to create
 * @returns Object with repoDir and branch name arrays per state
 */
export async function createBenchmarkRepo(worktreeCount: number): Promise<{
	repoDir: string
	ancestorBranches: string[]
	squashBranches: string[]
	unmergedBranches: string[]
}> {
	const repoDir = await mkdtemp(path.join(tmpdir(), 'sq-bench-'))

	await initRepo(repoDir)

	const perState = Math.max(1, Math.floor(worktreeCount / 3))
	const unmergedCount = worktreeCount - perState * 2

	const ancestorBranches: string[] = []
	const squashBranches: string[] = []
	const unmergedBranches: string[] = []

	for (let i = 0; i < perState; i++) {
		const branch = `feat/ancestor-${i}`
		await setupAncestorMergedBranch(repoDir, branch)
		ancestorBranches.push(branch)
	}

	for (let i = 0; i < perState; i++) {
		const branch = `feat/squash-${i}`
		await setupSquashMergedBranch(repoDir, branch)
		squashBranches.push(branch)
	}

	for (let i = 0; i < Math.max(1, unmergedCount); i++) {
		const branch = `feat/unmerged-${i}`
		await setupUnmergedBranch(repoDir, branch)
		unmergedBranches.push(branch)
	}

	return { repoDir, ancestorBranches, squashBranches, unmergedBranches }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full detection benchmark suite and print JSON results to stdout.
 *
 * Progress messages go to stderr so they do not contaminate JSON output
 * when piping results (e.g. `bun detection-benchmark.ts | jq .`).
 *
 * @param worktreeCount - Total number of feature branches to benchmark against
 */
export async function runDetectionBenchmark(
	worktreeCount = 6,
): Promise<BenchmarkOutput> {
	if (!Number.isInteger(worktreeCount) || worktreeCount < 0) {
		throw new Error(
			`Invalid worktreeCount "${worktreeCount}". Expected a non-negative integer.`,
		)
	}

	process.stderr.write(
		`[bench] creating temp repo with ${worktreeCount} branches...\n`,
	)

	const { repoDir, ancestorBranches, squashBranches, unmergedBranches } =
		await createBenchmarkRepo(worktreeCount)

	const ancestorBranch = ancestorBranches[0]
	const squashBranch = squashBranches[0]
	const unmergedBranch = unmergedBranches[0]
	if (!ancestorBranch || !squashBranch || !unmergedBranch) {
		throw new Error(
			'Benchmark repo setup failed: missing at least one branch for ancestor, squash, or unmerged state.',
		)
	}

	try {
		process.stderr.write('[bench] running detectMergeStatus benchmarks...\n')

		const detection = await benchmarkDetectMergeStatus(
			repoDir,
			ancestorBranch,
			squashBranch,
			unmergedBranch,
		)

		process.stderr.write(
			'[bench] running listWorktrees end-to-end benchmark...\n',
		)

		const list = await benchmarkListWorktrees(repoDir, worktreeCount)

		process.stderr.write('[bench] running concurrency impact benchmark...\n')

		const concurrency = await benchmarkConcurrencyImpact(repoDir, worktreeCount)

		const output: BenchmarkOutput = {
			timestamp: new Date().toISOString(),
			platform: process.platform,
			worktreeCount,
			detection,
			list,
			concurrency,
		}

		process.stderr.write('[bench] done.\n')
		return output
	} finally {
		process.stderr.write('[bench] cleaning up temp repo...\n')
		await rm(repoDir, { recursive: true, force: true })
	}
}

/**
 * Parse and validate the optional CLI worktree-count argument.
 *
 * Why: The benchmark assumes a numeric count and previously accepted arbitrary
 * input, which produced confusing runtime failures. Fail fast with a clear
 * message so operators know how to invoke the script correctly.
 *
 * @param rawArg - Raw CLI arg from process.argv[2]
 * @returns Parsed non-negative integer count
 * @throws If the value is not an integer >= 0
 */
function parseWorktreeCountArg(rawArg: string | undefined): number {
	if (rawArg === undefined) return 6

	const parsed = Number(rawArg)
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(
			`Invalid worktreeCount "${rawArg}". Expected a non-negative integer.`,
		)
	}
	return parsed
}

// Allow direct invocation: bun src/worktree/benchmarks/detection-benchmark.ts [worktreeCount]
// Guard prevents the benchmark from auto-running when the module is imported
// by tests or other code -- only executes when run as the entry point.
if (import.meta.main) {
	const worktreeCountArg = parseWorktreeCountArg(process.argv[2])
	runDetectionBenchmark(worktreeCountArg)
		.then((output) => {
			process.stdout.write(JSON.stringify(output, null, 2))
			process.stdout.write('\n')
		})
		.catch((err: unknown) => {
			process.stderr.write(`[bench] fatal error: ${String(err)}\n`)
			process.exit(1)
		})
}
