import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkCommand, checkFileEdit, getCurrentBranch, isCommitCommand } from '../src/index.js'

describe('checkCommand', () => {
	test('blocks force push', () => {
		expect(checkCommand('git push --force origin main').blocked).toBe(true)
		expect(checkCommand('git push -f origin main').blocked).toBe(true)
	})

	test('blocks destructive commands', () => {
		expect(checkCommand('git reset --hard HEAD~1').blocked).toBe(true)
		expect(checkCommand('git clean -fd').blocked).toBe(true)
		expect(checkCommand('git checkout .').blocked).toBe(true)
		expect(checkCommand('git restore .').blocked).toBe(true)
		expect(checkCommand('git branch -D feature/old').blocked).toBe(true)
	})

	test('allows safe commands', () => {
		expect(checkCommand('git push origin main').blocked).toBe(false)
		expect(checkCommand('git push --force-with-lease origin main').blocked).toBe(false)
		expect(checkCommand('git status').blocked).toBe(false)
	})
})

describe('checkFileEdit', () => {
	test('blocks protected paths', () => {
		expect(checkFileEdit('/project/.env').blocked).toBe(true)
		expect(checkFileEdit('/project/credentials/api-key.txt').blocked).toBe(true)
		expect(checkFileEdit('/project/.git/config').blocked).toBe(true)
	})

	test('allows regular files', () => {
		expect(checkFileEdit('/project/src/index.ts').blocked).toBe(false)
		expect(checkFileEdit('/project/.gitignore').blocked).toBe(false)
	})
})

describe('isCommitCommand', () => {
	test('detects commit and wip', () => {
		expect(isCommitCommand('git commit -m "feat: x"')).toEqual({
			isCommit: true,
			isWip: false,
		})
		expect(isCommitCommand('git commit --no-verify -m "wip"')).toEqual({
			isCommit: true,
			isWip: true,
		})
	})

	test('does not detect commit-like strings', () => {
		expect(isCommitCommand('git commit-tree abc123').isCommit).toBe(false)
		expect(isCommitCommand("echo 'git commit'").isCommit).toBe(false)
	})
})

describe('getCurrentBranch', () => {
	test('returns branch name or null for detached HEAD', async () => {
		const branch = await getCurrentBranch(process.cwd())
		// In CI (GitHub Actions), the checkout is often detached HEAD,
		// so getCurrentBranch returns null. Accept either a non-empty
		// string or null - both are valid results inside a git repo.
		if (branch !== null) {
			expect(typeof branch).toBe('string')
			expect(branch.length).toBeGreaterThan(0)
		}
	})

	test('returns null outside git repo', async () => {
		const nonRepo = path.join(tmpdir(), `no-git-${Date.now()}`)
		fs.mkdirSync(nonRepo, { recursive: true })
		try {
			expect(await getCurrentBranch(nonRepo)).toBeNull()
		} finally {
			fs.rmSync(nonRepo, { recursive: true, force: true })
		}
	})
})
