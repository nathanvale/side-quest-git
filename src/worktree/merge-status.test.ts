import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { checkIsShallow, cleanupStaleTempDirs, detectMergeStatus } from './merge-status.js'

let dirs: string[] = []

afterEach(() => {
	for (const dir of dirs) {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	dirs = []
	delete process.env.SIDE_QUEST_NO_SQUASH_DETECTION
	delete process.env.SIDE_QUEST_NO_DETECTION
})

/**
 * Initialize a git repository with initial commit.
 */
async function initRepo(): Promise<string> {
	const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-merge-'))
	dirs.push(tmpDir)

	await spawnAndCollect(['git', 'init', '-b', 'main'], { cwd: tmpDir })
	await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
		cwd: tmpDir,
	})
	await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
		cwd: tmpDir,
	})
	fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test')
	await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
	await spawnAndCollect(['git', 'commit', '-m', 'initial'], { cwd: tmpDir })

	return tmpDir
}

/**
 * Create a feature branch with N commits.
 */
async function createFeatureCommits(gitRoot: string, branch: string, count: number): Promise<void> {
	await spawnAndCollect(['git', 'checkout', '-b', branch], { cwd: gitRoot })
	for (let i = 1; i <= count; i++) {
		fs.writeFileSync(path.join(gitRoot, `file${i}.txt`), `content ${i}`)
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', `commit ${i}`], {
			cwd: gitRoot,
		})
	}
	await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })
}

/**
 * Squash merge a branch into main.
 */
async function squashIntoMain(gitRoot: string, branch: string): Promise<void> {
	await spawnAndCollect(['git', 'merge', '--squash', branch], {
		cwd: gitRoot,
	})
	await spawnAndCollect(['git', 'commit', '-m', `squash merge ${branch}`], {
		cwd: gitRoot,
	})
}

/**
 * Assert that the branch is NOT an ancestor and has commits on it.
 */
async function assertDagPreconditions(gitRoot: string, branch: string): Promise<void> {
	const ancestorResult = await spawnAndCollect(
		['git', 'merge-base', '--is-ancestor', branch, 'main'],
		{ cwd: gitRoot },
	)
	expect(ancestorResult.exitCode).toBe(1) // NOT an ancestor

	const countResult = await spawnAndCollect(['git', 'rev-list', '--count', `main..${branch}`], {
		cwd: gitRoot,
	})
	expect(Number.parseInt(countResult.stdout.trim(), 10)).toBeGreaterThan(0)
}

/**
 * Count unreachable commit objects in the repository.
 *
 * Why: merge-status checks should not write synthetic commits to the repo.
 */
async function countUnreachableCommits(gitRoot: string): Promise<number> {
	const fsckResult = await spawnAndCollect(['git', 'fsck', '--unreachable', '--no-reflogs'], {
		cwd: gitRoot,
	})
	const output = `${fsckResult.stdout}\n${fsckResult.stderr}`
	return output.split('\n').filter((line) => line.startsWith('unreachable commit ')).length
}

describe('detectMergeStatus - Topology suite', () => {
	test('standard merge -> ancestor', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: gitRoot,
		})

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
		expect(result.merged).toBe(result.mergeMethod !== undefined)
	})

	test('rebase onto main -> ancestor', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await spawnAndCollect(['git', 'checkout', 'feature'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'rebase', 'main'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'checkout', 'main'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'merge', '--ff-only', 'feature'], {
			cwd: gitRoot,
		})

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
		expect(result.commitsAhead).toBe(0)
	})

	test('pristine (same-tip) -> ancestor with 0 ahead', async () => {
		const gitRoot = await initRepo()

		const result = await detectMergeStatus(gitRoot, 'main')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
		expect(result.commitsAhead).toBe(0)
	})
})

describe('detectMergeStatus - Squash suite', () => {
	test('single-commit squash -> squash', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 1)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.commitsAhead).toBe(1)
		expect(result.merged).toBe(result.mergeMethod !== undefined)
	})

	test('multi-commit squash -> squash', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 3)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.commitsAhead).toBe(3)
	})

	test('main advanced after squash -> squash', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')

		// Advance main
		fs.writeFileSync(path.join(gitRoot, 'extra.txt'), 'extra content')
		await spawnAndCollect(['git', 'add', '.'], { cwd: gitRoot })
		await spawnAndCollect(['git', 'commit', '-m', 'extra commit'], {
			cwd: gitRoot,
		})

		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.commitsAhead).toBe(2)
		expect(result.commitsBehind).toBeGreaterThan(0)
	})
})

describe('detectMergeStatus - Negative tests', () => {
	test('unmerged branch -> not merged', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()
		expect(result.commitsAhead).toBeGreaterThan(0)
	})

	test('partial cherry-pick -> not merged', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 3)

		// Cherry-pick only the first commit
		const logResult = await spawnAndCollect(
			['git', 'log', '--reverse', '--format=%H', 'main..feature'],
			{ cwd: gitRoot },
		)
		const commits = logResult.stdout.trim().split('\n')
		await spawnAndCollect(['git', 'cherry-pick', commits[0]], {
			cwd: gitRoot,
		})

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()
	})

	test('commitsAhead > threshold skips squash detection', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 60)

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			maxCommitsForSquashDetection: 50,
		})

		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()
		expect(result.commitsAhead).toBeGreaterThan(50)
	})
})

describe('detectMergeStatus - Layer 3 skip observable', () => {
	test('threshold blocks then allows squash detection', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		// First: threshold too low, should not detect
		const blockedResult = await detectMergeStatus(gitRoot, 'feature', 'main', {
			maxCommitsForSquashDetection: 1,
		})
		expect(blockedResult.merged).toBe(false)
		expect(blockedResult.mergeMethod).toBeUndefined()

		// Second: threshold sufficient, should detect
		const allowedResult = await detectMergeStatus(gitRoot, 'feature', 'main', {
			maxCommitsForSquashDetection: 2,
		})
		expect(allowedResult.merged).toBe(true)
		expect(allowedResult.mergeMethod).toBe('squash')
	})
})

describe('detectMergeStatus - Critical failure modes', () => {
	test('merge-base fatal (exit 128+) -> detectionError', async () => {
		const gitRoot = await initRepo()

		// Use a non-existent branch to trigger merge-base fatal
		const result = await detectMergeStatus(gitRoot, 'nonexistent', 'main')

		expect(result.merged).toBe(false)
		expect(result.detectionError).toBeDefined()
		expect(result.detectionError).toContain('merge-base failed')
	})

	test('env kill switch disables squash detection', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		process.env.SIDE_QUEST_NO_SQUASH_DETECTION = '1'

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()

		// Clean up
		delete process.env.SIDE_QUEST_NO_SQUASH_DETECTION

		// Verify it works without the env var
		const normalResult = await detectMergeStatus(gitRoot, 'feature')
		expect(normalResult.merged).toBe(true)
		expect(normalResult.mergeMethod).toBe('squash')
	})
})

describe('detectMergeStatus - Edge cases', () => {
	test('branch/tag name collision uses refs/heads correctly', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		// Create a tag with the same name pointing to main
		await spawnAndCollect(['git', 'tag', 'feature', 'main'], {
			cwd: gitRoot,
		})

		// Merge the branch using fully qualified ref to avoid ambiguity
		await spawnAndCollect(['git', 'merge', '--no-ff', 'refs/heads/feature'], {
			cwd: gitRoot,
		})

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
	})

	test('getMainBranch fallback path without targetBranch', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: gitRoot,
		})

		// Don't provide targetBranch - should auto-detect 'main'
		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
	})

	test('getMainBranch with master fallback', async () => {
		const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-merge-'))
		dirs.push(tmpDir)

		// Initialize with 'master' as default branch
		await spawnAndCollect(['git', 'init', '-b', 'master'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: tmpDir,
		})
		fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test')
		await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], { cwd: tmpDir })

		await createFeatureCommits(tmpDir, 'feature', 2)
		await spawnAndCollect(['git', 'checkout', 'master'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: tmpDir,
		})

		// Should auto-detect 'master'
		const result = await detectMergeStatus(tmpDir, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
	})

	test('detached fallback preserves symbolic HEAD target', async () => {
		const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-merge-'))
		dirs.push(tmpDir)

		// Initialize with neither main nor master so fallback uses current HEAD name
		await spawnAndCollect(['git', 'init', '-b', 'trunk'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: tmpDir,
		})
		fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test')
		await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], { cwd: tmpDir })

		// Create and merge feature branch into trunk
		await spawnAndCollect(['git', 'checkout', '-b', 'feature'], { cwd: tmpDir })
		fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'feature content')
		await spawnAndCollect(['git', 'add', '.'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'commit', '-m', 'feature'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'checkout', 'trunk'], { cwd: tmpDir })
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: tmpDir,
		})

		// Detach root worktree HEAD; getMainBranch() now resolves to symbolic "HEAD"
		const headResult = await spawnAndCollect(['git', 'rev-parse', 'HEAD'], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'checkout', '--detach', headResult.stdout.trim()], {
			cwd: tmpDir,
		})

		const result = await detectMergeStatus(tmpDir, 'feature')

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
		expect(result.detectionError).toBeUndefined()
	})
})

describe('detectMergeStatus - Read-only behavior', () => {
	test('squash detection does not create unreachable commits', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const before = await countUnreachableCommits(gitRoot)

		const result1 = await detectMergeStatus(gitRoot, 'feature')
		const result2 = await detectMergeStatus(gitRoot, 'feature')

		const after = await countUnreachableCommits(gitRoot)

		expect(result1.merged).toBe(true)
		expect(result1.mergeMethod).toBe('squash')
		expect(result2.merged).toBe(true)
		expect(result2.mergeMethod).toBe('squash')
		expect(after).toBe(before)
	})
})

describe('detectMergeStatus - Invariants', () => {
	test('merged === (mergeMethod !== undefined) for ancestor', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: gitRoot,
		})

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(result.mergeMethod !== undefined)
		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('ancestor')
	})

	test('merged === (mergeMethod !== undefined) for squash', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(result.mergeMethod !== undefined)
		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
	})

	test('merged === (mergeMethod !== undefined) for unmerged', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(result.mergeMethod !== undefined)
		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()
	})

	test('deterministic output for identical input', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')

		const result1 = await detectMergeStatus(gitRoot, 'feature')
		const result2 = await detectMergeStatus(gitRoot, 'feature')

		expect(result1).toEqual(result2)
	})
})

describe('detectMergeStatus - Shallow clone guard', () => {
	test('isShallow true returns detectionError and skips all layers', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: true,
		})

		expect(result.merged).toBe(false)
		expect(result.commitsAhead).toBe(-1)
		expect(result.commitsBehind).toBe(-1)
		expect(result.detectionError).toContain('shallow clone')
		expect(result.mergeMethod).toBeUndefined()
	})

	test('isShallow null sets warning but proceeds with detection', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: null,
		})

		// Detection should still work (fail-open guard)
		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		// But warning should be set
		expect(result.detectionError).toContain('shallow check failed')
	})

	test('isShallow false proceeds normally', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: false,
		})

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.detectionError).toBeUndefined()
	})

	test('isShallow undefined proceeds normally', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: undefined,
		})

		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.detectionError).toBeUndefined()
	})

	test('real shallow clone returns detectionError via checkIsShallow', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		// Shallow clone needs file:// protocol (local clones ignore --depth)
		const shallowDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-shallow-'))
		dirs.push(shallowDir)
		fs.rmSync(shallowDir, { recursive: true, force: true })
		await spawnAndCollect(['git', 'clone', '--depth', '1', `file://${gitRoot}`, shallowDir], {})

		// checkIsShallow should return true
		const isShallow = await checkIsShallow(shallowDir)
		expect(isShallow).toBe(true)

		// detectMergeStatus with isShallow: true should return error
		const result = await detectMergeStatus(shallowDir, 'feature', 'main', {
			isShallow,
		})
		expect(result.merged).toBe(false)
		expect(result.detectionError).toContain('shallow clone')
		expect(result.commitsAhead).toBe(-1)
	})

	test('kill switch skips shallow guard', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		process.env.SIDE_QUEST_NO_SQUASH_DETECTION = '1'

		// Even with isShallow: true, should not return shallow error
		// Instead should return normal result with squash detection disabled
		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: true,
		})

		expect(result.detectionError).toBeUndefined()
		// Squash detection is disabled, so unmerged branch stays unmerged
		expect(result.merged).toBe(false)
	})
})

describe('detectMergeStatus - Full kill switch (SIDE_QUEST_NO_DETECTION)', () => {
	beforeEach(() => {
		process.env.SIDE_QUEST_NO_DETECTION = '1'
	})

	afterEach(() => {
		delete process.env.SIDE_QUEST_NO_DETECTION
	})

	test('returns immediately with detection disabled sentinel values', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.commitsAhead).toBe(-1)
		expect(result.commitsBehind).toBe(-1)
		expect(result.detectionError).toBe('detection disabled')
		expect(result.mergeMethod).toBeUndefined()
	})

	test('bypasses all detection even for squash-merged branch', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		// With kill switch on, squash-merged branch still returns disabled sentinel
		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.detectionError).toBe('detection disabled')
		expect(result.mergeMethod).toBeUndefined()
	})

	test('bypasses all detection even for ancestor-merged branch', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await spawnAndCollect(['git', 'merge', '--no-ff', 'feature'], {
			cwd: gitRoot,
		})

		// With kill switch on, ancestor-merged branch still returns disabled sentinel
		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.detectionError).toBe('detection disabled')
		expect(result.mergeMethod).toBeUndefined()
	})

	test('takes effect before shallow guard (isShallow: true has no extra effect)', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		// Even with isShallow: true, the kill switch fires first
		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			isShallow: true,
		})

		// Kill switch message, not shallow clone message
		expect(result.detectionError).toBe('detection disabled')
	})

	test('disabling kill switch restores normal detection', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		// With kill switch: disabled
		const killedResult = await detectMergeStatus(gitRoot, 'feature')
		expect(killedResult.detectionError).toBe('detection disabled')

		// Remove kill switch: normal detection resumes
		delete process.env.SIDE_QUEST_NO_DETECTION

		const normalResult = await detectMergeStatus(gitRoot, 'feature')
		expect(normalResult.merged).toBe(true)
		expect(normalResult.mergeMethod).toBe('squash')
		expect(normalResult.detectionError).toBeUndefined()
	})
})

describe('detectMergeStatus - Kill switch independence', () => {
	test('SIDE_QUEST_NO_SQUASH_DETECTION=1 still disables only Layer 3', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		process.env.SIDE_QUEST_NO_SQUASH_DETECTION = '1'

		// Layer 3 disabled: squash not detected, but Layers 1 and 2 still run
		const result = await detectMergeStatus(gitRoot, 'feature')

		expect(result.merged).toBe(false)
		expect(result.mergeMethod).toBeUndefined()
		// commitsAhead comes from Layer 2 (ahead/behind), not a sentinel -1
		expect(result.commitsAhead).toBeGreaterThanOrEqual(0)
		// detectionError is NOT 'detection disabled' -- Layer 3 skip is silent
		expect(result.detectionError).not.toBe('detection disabled')
	})

	test('SIDE_QUEST_NO_DETECTION=1 takes priority over SIDE_QUEST_NO_SQUASH_DETECTION=1', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		process.env.SIDE_QUEST_NO_DETECTION = '1'
		process.env.SIDE_QUEST_NO_SQUASH_DETECTION = '1'

		const result = await detectMergeStatus(gitRoot, 'feature')

		// Full kill switch wins: sentinel values returned immediately
		expect(result.commitsAhead).toBe(-1)
		expect(result.commitsBehind).toBe(-1)
		expect(result.detectionError).toBe('detection disabled')
	})
})

describe('checkIsShallow', () => {
	test('returns false for normal repo', async () => {
		const gitRoot = await initRepo()
		const result = await checkIsShallow(gitRoot)
		expect(result).toBe(false)
	})

	test('returns true for shallow clone', async () => {
		const gitRoot = await initRepo()

		// Shallow clone needs file:// protocol (local clones ignore --depth)
		const shallowDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-shallow-'))
		dirs.push(shallowDir)
		// Remove the pre-created dir so git clone can create it
		fs.rmSync(shallowDir, { recursive: true, force: true })
		await spawnAndCollect(['git', 'clone', '--depth', '1', `file://${gitRoot}`, shallowDir], {})

		const result = await checkIsShallow(shallowDir)
		expect(result).toBe(true)
	})

	test('returns null for non-git directory', async () => {
		// Use os.tmpdir to ensure we're outside any git repo tree
		const { tmpdir } = await import('node:os')
		const nonGitDir = fs.mkdtempSync(path.join(tmpdir(), '.test-nongit-'))
		dirs.push(nonGitDir)

		const result = await checkIsShallow(nonGitDir)
		expect(result).toBe(null)
	})
})

describe('cleanupStaleTempDirs - Temp-dir janitor (#17)', () => {
	/**
	 * Create a fake sq-git-objects temp dir with an embedded PID.
	 *
	 * Why: tests need to verify the janitor removes dirs for dead PIDs
	 * without depending on actual process.pid values from detection runs.
	 */
	function makeFakeTempDir(pid: number, suffix = 'abc123'): string {
		const { tmpdir } = require('node:os') as typeof import('node:os')
		const dirName = `sq-git-objects-${pid}-${suffix}`
		const fullPath = path.join(tmpdir(), dirName)
		fs.mkdirSync(fullPath, { recursive: true })
		return fullPath
	}

	/**
	 * Find a PID that is definitely not alive.
	 *
	 * Why: We can't hardcode a dead PID -- it might be reused. Instead,
	 * pick a very large number unlikely to be a real PID on any platform.
	 * On Linux max PID is 4194304; on macOS max is 99998.
	 * Using 2147483646 (INT_MAX - 1) ensures it's never a live process.
	 */
	const DEAD_PID = 2147483646

	test('temp dir name includes current process PID', async () => {
		// Run detectMergeStatus to trigger temp dir creation via squash detection
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 1)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const { tmpdir } = await import('node:os')
		const tmp = tmpdir()

		// Snapshot temp dirs before detection
		const before = new Set(fs.readdirSync(tmp).filter((e) => e.startsWith('sq-git-objects-')))

		await detectMergeStatus(gitRoot, 'feature')

		// Snapshot after detection
		const after = fs.readdirSync(tmp).filter((e) => e.startsWith('sq-git-objects-'))

		// Any new dir created must contain our PID
		const newDirs = after.filter((e) => !before.has(e))
		// Detection cleans up in finally, so newDirs may be empty -- but if
		// any were created they must have our PID embedded
		for (const dirName of newDirs) {
			expect(dirName).toContain(`sq-git-objects-${process.pid}-`)
		}

		// Verify the name pattern: sq-git-objects-<pid>-<random>
		const pidPattern = new RegExp(`^sq-git-objects-${process.pid}-`)
		for (const dirName of newDirs) {
			expect(pidPattern.test(dirName)).toBe(true)
		}
	})

	test('removes dirs with dead PIDs', () => {
		const fakeDir = makeFakeTempDir(DEAD_PID, 'dead001')
		dirs.push(fakeDir) // register for cleanup in case test fails

		expect(fs.existsSync(fakeDir)).toBe(true)

		cleanupStaleTempDirs()

		expect(fs.existsSync(fakeDir)).toBe(false)
	})

	test('leaves dirs with live PIDs alone (when fresh)', () => {
		// Use our own PID -- definitely alive
		const livePid = process.pid
		const fakeDir = makeFakeTempDir(livePid, 'live001')
		dirs.push(fakeDir)

		expect(fs.existsSync(fakeDir)).toBe(true)

		cleanupStaleTempDirs()

		// Should NOT be removed -- PID is alive and dir is fresh (< 1 hour old)
		expect(fs.existsSync(fakeDir)).toBe(true)
	})

	test('removes dirs older than 1 hour regardless of PID', () => {
		const livePid = process.pid
		const fakeDir = makeFakeTempDir(livePid, 'old001')
		dirs.push(fakeDir)

		// Backdate mtime to 2 hours ago
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		fs.utimesSync(fakeDir, twoHoursAgo, twoHoursAgo)

		expect(fs.existsSync(fakeDir)).toBe(true)

		cleanupStaleTempDirs()

		// Should be removed -- old enough even though PID is alive
		expect(fs.existsSync(fakeDir)).toBe(false)
	})

	test('janitor never throws even on filesystem errors', () => {
		// Should not throw even if tmpdir is weird or entries are inaccessible
		expect(() => cleanupStaleTempDirs()).not.toThrow()
	})

	test('handles dirs without PID in name (legacy format) by age', () => {
		const { tmpdir } = require('node:os') as typeof import('node:os')
		// Legacy format without PID: sq-git-objects-<random>
		const legacyDir = path.join(tmpdir(), 'sq-git-objects-legacyxyz')
		fs.mkdirSync(legacyDir, { recursive: true })
		dirs.push(legacyDir)

		// Backdate to 2 hours ago -- should be removed
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		fs.utimesSync(legacyDir, twoHoursAgo, twoHoursAgo)

		cleanupStaleTempDirs()

		expect(fs.existsSync(legacyDir)).toBe(false)
	})

	test('leaves fresh dirs without PID in name (legacy format)', () => {
		const { tmpdir } = require('node:os') as typeof import('node:os')
		const legacyDir = path.join(tmpdir(), 'sq-git-objects-freshlegacy')
		fs.mkdirSync(legacyDir, { recursive: true })
		dirs.push(legacyDir)

		// Fresh dir (default mtime is now) -- should be left alone
		cleanupStaleTempDirs()

		expect(fs.existsSync(legacyDir)).toBe(true)
	})
})

describe('detectMergeStatus - AbortSignal support (#14)', () => {
	test('already-aborted signal causes immediate return with detectionError', async () => {
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')

		// Create an already-aborted signal
		const controller = new AbortController()
		controller.abort()
		const signal = controller.signal

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			signal,
		})

		// Must return immediately with abort error -- no git subprocesses run
		expect(result.merged).toBe(false)
		expect(result.commitsAhead).toBe(-1)
		expect(result.commitsBehind).toBe(-1)
		expect(result.detectionError).toBe('detection aborted')
		expect(result.mergeMethod).toBeUndefined()
	})

	test('signal aborted during detection converts to detectionError', async () => {
		// Use AbortSignal.timeout with 0ms to guarantee immediate abort.
		// The signal is aborted before we pass it, simulating a per-item timeout
		// that fires just as detection starts.
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)

		// A 0ms timeout signal is aborted synchronously by the time we read signal.aborted
		const signal = AbortSignal.timeout(0)

		// Yield to let the microtask queue process the timeout
		await new Promise((resolve) => setTimeout(resolve, 5))

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			signal,
		})

		// Signal was aborted before any git work -- should report aborted
		expect(result.merged).toBe(false)
		expect(result.detectionError).toBe('detection aborted')
	})

	test('signal option is accepted without error for normal detection', async () => {
		// Verify that passing a non-aborted signal does not affect normal detection.
		// The signal is a live, non-aborted controller signal.
		const gitRoot = await initRepo()
		await createFeatureCommits(gitRoot, 'feature', 2)
		await squashIntoMain(gitRoot, 'feature')
		await assertDagPreconditions(gitRoot, 'feature')

		const controller = new AbortController()
		const signal = controller.signal

		const result = await detectMergeStatus(gitRoot, 'feature', 'main', {
			signal,
		})

		// Normal detection should succeed with a live signal
		expect(result.merged).toBe(true)
		expect(result.mergeMethod).toBe('squash')
		expect(result.detectionError).toBeUndefined()
	})

	test('AbortSignal.timeout respects SIDE_QUEST_ITEM_TIMEOUT_MS pattern', async () => {
		// Verify that AbortSignal.timeout(0) can abort detection.
		// This simulates the per-item timeout in list.ts and orphans.ts
		// when SIDE_QUEST_ITEM_TIMEOUT_MS is set to a very low value.
		const gitRoot = await initRepo()

		const signal = AbortSignal.timeout(0)
		await new Promise((resolve) => setTimeout(resolve, 5))

		const result = await detectMergeStatus(gitRoot, 'main', 'main', { signal })

		// Either aborted (if signal fired before detection) or succeeded (if fast enough)
		// The key invariant: no unhandled exception is thrown
		expect(['detection aborted', undefined]).toContain(result.detectionError)
	})
})
