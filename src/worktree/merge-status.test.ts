import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { checkIsShallow, detectMergeStatus } from './merge-status.js'

let dirs: string[] = []

afterEach(() => {
	for (const dir of dirs) {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	dirs = []
	delete process.env.SIDE_QUEST_NO_SQUASH_DETECTION
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
		expect(result.commitsAhead).toBe(0)
		expect(result.commitsBehind).toBe(0)
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

describe('checkIsShallow', () => {
	test('returns false for normal repo', async () => {
		const gitRoot = await initRepo()
		const result = await checkIsShallow(gitRoot)
		expect(result).toBe(false)
	})
})
