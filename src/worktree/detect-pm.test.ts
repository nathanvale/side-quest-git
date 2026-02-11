import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { detectInstallCommand, detectLockfile, detectPackageManager } from './detect-pm.js'

describe('detectInstallCommand', () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('returns null when no lockfile exists', () => {
		expect(detectInstallCommand(tmpDir)).toBeNull()
	})

	test('detects bun.lock', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
		expect(detectInstallCommand(tmpDir)).toBe('bun install')
	})

	test('detects bun.lockb', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '')
		expect(detectInstallCommand(tmpDir)).toBe('bun install')
	})

	test('detects yarn.lock', () => {
		fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
		expect(detectInstallCommand(tmpDir)).toBe('yarn install')
	})

	test('detects pnpm-lock.yaml', () => {
		fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
		expect(detectInstallCommand(tmpDir)).toBe('pnpm install')
	})

	test('detects package-lock.json', () => {
		fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '')
		expect(detectInstallCommand(tmpDir)).toBe('npm install')
	})

	test('bun takes priority over yarn', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
		fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
		expect(detectInstallCommand(tmpDir)).toBe('bun install')
	})

	test('yarn takes priority over pnpm', () => {
		fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
		fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
		expect(detectInstallCommand(tmpDir)).toBe('yarn install')
	})

	test('pnpm takes priority over npm', () => {
		fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
		fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '')
		expect(detectInstallCommand(tmpDir)).toBe('pnpm install')
	})
})

describe('detectPackageManager', () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('returns bun for bun.lock', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
		expect(detectPackageManager(tmpDir)).toBe('bun')
	})

	test('returns yarn for yarn.lock', () => {
		fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
		expect(detectPackageManager(tmpDir)).toBe('yarn')
	})

	test('returns pnpm for pnpm-lock.yaml', () => {
		fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
		expect(detectPackageManager(tmpDir)).toBe('pnpm')
	})

	test('returns npm for package-lock.json', () => {
		fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '')
		expect(detectPackageManager(tmpDir)).toBe('npm')
	})

	test('returns null when no lockfile and no package.json', () => {
		expect(detectPackageManager(tmpDir)).toBeNull()
	})

	test('falls back to packageManager field in package.json', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'package.json'),
			JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
		)
		expect(detectPackageManager(tmpDir)).toBe('pnpm')
	})

	test('returns null for unrecognized packageManager value', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'package.json'),
			JSON.stringify({ packageManager: 'unknown@1.0.0' }),
		)
		expect(detectPackageManager(tmpDir)).toBeNull()
	})

	test('lockfile takes priority over packageManager field', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
		fs.writeFileSync(
			path.join(tmpDir, 'package.json'),
			JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
		)
		expect(detectPackageManager(tmpDir)).toBe('bun')
	})
})

describe('detectLockfile', () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(import.meta.dir, '.test-scratch-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	test('returns lockfile path when found', () => {
		fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
		expect(detectLockfile(tmpDir)).toBe(path.join(tmpDir, 'bun.lock'))
	})

	test('returns null when no lockfile exists', () => {
		expect(detectLockfile(tmpDir)).toBeNull()
	})

	test('returns first lockfile by priority', () => {
		fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
		fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '')
		expect(detectLockfile(tmpDir)).toBe(path.join(tmpDir, 'yarn.lock'))
	})
})
