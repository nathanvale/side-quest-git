import { describe, expect, test } from 'bun:test'
import { buildStatusString } from './status-string.js'

describe('buildStatusString', () => {
	test('pristine: merged at same tip, clean', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 0,
				commitsBehind: 0,
				mergeMethod: 'ancestor',
			}),
		).toBe('pristine')
	})

	test('standard merge: merged, ahead, clean', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 1,
				mergeMethod: 'ancestor',
			}),
		).toBe('merged')
	})

	test('squash merge: merged, ahead, clean', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 1,
				mergeMethod: 'squash',
			}),
		).toBe('merged (squash)')
	})

	test('multi-commit squash: merged, multiple commits ahead, clean', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 3,
				mergeMethod: 'squash',
			}),
		).toBe('merged (squash)')
	})

	test('not merged, ahead: unmerged branch with commits', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: false,
				commitsAhead: 5,
			}),
		).toBe('5 ahead')
	})

	test('not merged, ahead, dirty: unmerged with uncommitted changes', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: true,
				commitsAhead: 3,
			}),
		).toBe('3 ahead, dirty')
	})

	test('merged, dirty (ancestor): standard merge with uncommitted changes', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: true,
				commitsAhead: 0,
				commitsBehind: 1,
				mergeMethod: 'ancestor',
			}),
		).toBe('merged, dirty')
	})

	test('dirty (at same commit): ancestor at same tip with dirty files', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: true,
				commitsAhead: 0,
				commitsBehind: 0,
				mergeMethod: 'ancestor',
			}),
		).toBe('dirty')
	})

	test('squash merged, dirty: squash merge with uncommitted changes', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: true,
				commitsAhead: 2,
				mergeMethod: 'squash',
			}),
		).toBe('merged (squash), dirty')
	})

	test('dirty only: uncommitted changes, no commits ahead', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: true,
				commitsAhead: 0,
			}),
		).toBe('dirty')
	})

	test('unknown/fallback: unexpected state', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: false,
				commitsAhead: 0,
			}),
		).toBe('unknown')
	})

	test('only behind: branch behind main with no local commits', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: false,
				commitsAhead: 0,
				commitsBehind: 2,
			}),
		).toBe('2 behind')
	})

	test('behind and dirty: branch behind main with uncommitted changes', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: true,
				commitsAhead: 0,
				commitsBehind: 3,
			}),
		).toBe('3 behind, dirty')
	})

	test('ahead and behind: diverged branch with local and upstream commits', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: false,
				commitsAhead: 3,
				commitsBehind: 2,
			}),
		).toBe('3 ahead, 2 behind')
	})

	test('ahead, behind, and dirty: diverged branch with uncommitted changes', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: true,
				commitsAhead: 4,
				commitsBehind: 1,
			}),
		).toBe('4 ahead, 1 behind, dirty')
	})

	test('merged with behind: merged branch where main has moved forward', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 0,
				commitsBehind: 5,
				mergeMethod: 'ancestor',
			}),
		).toBe('merged')
	})

	test('merged squash with behind: squash-merged branch where main has moved forward', () => {
		expect(
			buildStatusString({
				merged: true,
				dirty: false,
				commitsAhead: 0,
				commitsBehind: 3,
				mergeMethod: 'squash',
			}),
		).toBe('merged (squash)')
	})

	test('behind zero is treated as no behind count', () => {
		expect(
			buildStatusString({
				merged: false,
				dirty: false,
				commitsAhead: 0,
				commitsBehind: 0,
			}),
		).toBe('unknown')
	})
})
