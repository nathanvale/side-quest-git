import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldRunInstall } from './install.js'

describe('shouldRunInstall', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `install-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	test('returns true when node_modules does not exist', () => {
		writeFileSync(join(testDir, 'package.json'), '{}')
		writeFileSync(join(testDir, 'bun.lock'), 'lockfile content')
		expect(shouldRunInstall(testDir)).toBe(true)
	})

	test('returns true when lockfile is newer than node_modules', async () => {
		writeFileSync(join(testDir, 'package.json'), '{}')
		mkdirSync(join(testDir, 'node_modules'), { recursive: true })
		// Wait a bit to ensure different mtime
		await new Promise((r) => setTimeout(r, 50))
		writeFileSync(join(testDir, 'bun.lock'), 'lockfile content')
		expect(shouldRunInstall(testDir)).toBe(true)
	})

	test('returns false when node_modules is newer than lockfile', async () => {
		writeFileSync(join(testDir, 'package.json'), '{}')
		writeFileSync(join(testDir, 'bun.lock'), 'lockfile content')
		await new Promise((r) => setTimeout(r, 50))
		mkdirSync(join(testDir, 'node_modules'), { recursive: true })
		// Touch node_modules to make it newer
		writeFileSync(join(testDir, 'node_modules', '.marker'), '')
		expect(shouldRunInstall(testDir)).toBe(false)
	})

	test('returns false when no lockfile exists', () => {
		writeFileSync(join(testDir, 'package.json'), '{}')
		expect(shouldRunInstall(testDir)).toBe(false)
	})
})
