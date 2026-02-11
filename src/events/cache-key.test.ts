import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { getEventCacheDir, getRepoCacheKey } from './cache-key.js'

describe('getRepoCacheKey', () => {
	test('returns the same key for equivalent absolute paths', () => {
		const keyA = getRepoCacheKey('/tmp/example-repo')
		const keyB = getRepoCacheKey('/tmp/../tmp/example-repo')
		expect(keyA).toBe(keyB)
	})

	test('returns different keys for different roots with same basename', () => {
		const keyA = getRepoCacheKey('/tmp/a/app')
		const keyB = getRepoCacheKey('/tmp/b/app')
		expect(keyA).not.toBe(keyB)
	})
})

describe('getEventCacheDir', () => {
	test('includes the cache key as final path segment', () => {
		const cacheKey = getRepoCacheKey('/tmp/sample')
		const cacheDir = getEventCacheDir(cacheKey)
		expect(path.basename(cacheDir)).toBe(cacheKey)
	})
})
