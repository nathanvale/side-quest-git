/**
 * Tests for checkUpstreamGone.
 *
 * Uses real git repos to verify the upstream tracking ref detection works
 * correctly under the three meaningful states:
 *   1. No upstream configured (local-only branch) -- returns false
 *   2. Upstream exists and is reachable -- returns false
 *   3. Upstream branch was deleted on the remote -- returns true
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnAndCollect } from '@side-quest/core/spawn'
import { checkUpstreamGone } from './upstream-gone.js'

describe('checkUpstreamGone', () => {
	let tmpDir: string
	/** The "remote" bare repo (simulates GitHub). */
	let remoteDir: string
	/** The local clone of the remote. */
	let localDir: string

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-upstream-gone-'))
		remoteDir = path.join(tmpDir, 'remote.git')
		localDir = path.join(tmpDir, 'local')

		// Create a bare "remote" repo with an initial commit on main.
		await spawnAndCollect(['git', 'init', '--bare', '-b', 'main', remoteDir], {
			cwd: tmpDir,
		})

		// Create a non-bare staging area to add the initial commit to the remote.
		const stagingDir = path.join(tmpDir, 'staging')
		await spawnAndCollect(['git', 'init', '-b', 'main', stagingDir], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: stagingDir,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: stagingDir,
		})
		fs.writeFileSync(path.join(stagingDir, 'README.md'), '# Test')
		await spawnAndCollect(['git', 'add', '.'], { cwd: stagingDir })
		await spawnAndCollect(['git', 'commit', '-m', 'initial'], {
			cwd: stagingDir,
		})
		await spawnAndCollect(['git', 'remote', 'add', 'origin', remoteDir], { cwd: stagingDir })
		await spawnAndCollect(['git', 'push', 'origin', 'main'], {
			cwd: stagingDir,
		})

		// Clone the remote into localDir (this sets up origin and tracking refs).
		await spawnAndCollect(['git', 'clone', remoteDir, localDir], {
			cwd: tmpDir,
		})
		await spawnAndCollect(['git', 'config', 'user.email', 'test@test.com'], {
			cwd: localDir,
		})
		await spawnAndCollect(['git', 'config', 'user.name', 'Test'], {
			cwd: localDir,
		})
	})

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	test('returns false for a branch with no upstream configured', async () => {
		// Create a purely local branch with no remote tracking ref.
		await spawnAndCollect(['git', 'checkout', '-b', 'local-only'], {
			cwd: localDir,
		})

		const gone = await checkUpstreamGone(localDir, 'local-only')
		expect(gone).toBe(false)
	})

	test('returns false for a branch whose upstream exists and is reachable', async () => {
		// Create a branch, push it, then check -- the remote still has it.
		await spawnAndCollect(['git', 'checkout', '-b', 'feat/still-alive'], {
			cwd: localDir,
		})
		fs.writeFileSync(path.join(localDir, 'alive.txt'), 'alive')
		await spawnAndCollect(['git', 'add', '.'], { cwd: localDir })
		await spawnAndCollect(['git', 'commit', '-m', 'alive commit'], {
			cwd: localDir,
		})
		await spawnAndCollect(['git', 'push', '-u', 'origin', 'feat/still-alive'], { cwd: localDir })

		const gone = await checkUpstreamGone(localDir, 'feat/still-alive')
		expect(gone).toBe(false)
	})

	test('returns true for a branch whose remote tracking ref has been deleted', async () => {
		// 1. Create a branch and push it to establish a tracking ref.
		await spawnAndCollect(['git', 'checkout', '-b', 'feat/deleted-on-remote'], {
			cwd: localDir,
		})
		fs.writeFileSync(path.join(localDir, 'feature.txt'), 'work')
		await spawnAndCollect(['git', 'add', '.'], { cwd: localDir })
		await spawnAndCollect(['git', 'commit', '-m', 'feature work'], {
			cwd: localDir,
		})
		await spawnAndCollect(['git', 'push', '-u', 'origin', 'feat/deleted-on-remote'], {
			cwd: localDir,
		})

		// 2. Delete the branch on the remote (simulating GitHub "delete branch after merge").
		await spawnAndCollect(['git', 'push', 'origin', '--delete', 'feat/deleted-on-remote'], {
			cwd: localDir,
		})

		// 3. `git fetch --prune` updates local tracking refs to reflect the deletion.
		//    Without this, git doesn't know the remote branch is gone.
		await spawnAndCollect(['git', 'fetch', '--prune', 'origin'], {
			cwd: localDir,
		})

		// 4. After prune, `for-each-ref --format='%(upstream:track)'` on the local
		//    branch should show `[gone]`.
		const gone = await checkUpstreamGone(localDir, 'feat/deleted-on-remote')
		expect(gone).toBe(true)
	})

	test('returns false for the special (detached) branch name', async () => {
		// (detached) is a synthetic name used by parsePorcelainOutput -- it cannot
		// have a real upstream ref, so we short-circuit before calling git.
		const gone = await checkUpstreamGone(localDir, '(detached)')
		expect(gone).toBe(false)
	})

	test('returns false for an empty branch name', async () => {
		// Guard against caller passing an empty string.
		const gone = await checkUpstreamGone(localDir, '')
		expect(gone).toBe(false)
	})

	test('returns false when git command fails (e.g. path is not a git repo)', async () => {
		// A real directory that is not a git repo causes git to fail with a non-zero
		// exit code (fatal: not a git repository). Should not throw, should return false.
		const notARepo = path.join(tmpDir, 'not-a-git-repo')
		fs.mkdirSync(notARepo, { recursive: true })
		const gone = await checkUpstreamGone(notARepo, 'main')
		expect(gone).toBe(false)
	})

	test('returns false for main branch when remote main still exists', async () => {
		// main is tracked and remote has it -- should be false.
		const gone = await checkUpstreamGone(localDir, 'main')
		expect(gone).toBe(false)
	})
})
