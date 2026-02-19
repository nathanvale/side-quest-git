import { describe, expect, test } from 'bun:test'
import { createDetectionIssue, DETECTION_CODES, type DetectionIssue } from './detection-issue.js'

describe('DETECTION_CODES', () => {
	test('all expected codes are present', () => {
		expect(DETECTION_CODES.SHALLOW_CLONE).toBe('SHALLOW_CLONE')
		expect(DETECTION_CODES.SHALLOW_CHECK_FAILED).toBe('SHALLOW_CHECK_FAILED')
		expect(DETECTION_CODES.MERGE_BASE_FAILED).toBe('MERGE_BASE_FAILED')
		expect(DETECTION_CODES.MERGE_BASE_LOOKUP_FAILED).toBe('MERGE_BASE_LOOKUP_FAILED')
		expect(DETECTION_CODES.CHERRY_TIMEOUT).toBe('CHERRY_TIMEOUT')
		expect(DETECTION_CODES.CHERRY_FAILED).toBe('CHERRY_FAILED')
		expect(DETECTION_CODES.CHERRY_EMPTY).toBe('CHERRY_EMPTY')
		expect(DETECTION_CODES.CHERRY_INVALID).toBe('CHERRY_INVALID')
		expect(DETECTION_CODES.COMMIT_TREE_FAILED).toBe('COMMIT_TREE_FAILED')
		expect(DETECTION_CODES.GIT_PATH_FAILED).toBe('GIT_PATH_FAILED')
		expect(DETECTION_CODES.DETECTION_DISABLED).toBe('DETECTION_DISABLED')
		expect(DETECTION_CODES.ENRICHMENT_FAILED).toBe('ENRICHMENT_FAILED')
	})

	test('code values match their key names (self-describing)', () => {
		for (const [key, value] of Object.entries(DETECTION_CODES)) {
			expect(value).toBe(key)
		}
	})

	test('is a const object (values are string literals at runtime)', () => {
		// The `as const` assertion means the object is frozen conceptually.
		// At runtime, values are strings -- verify they're stable references.
		const code1 = DETECTION_CODES.SHALLOW_CLONE
		const code2 = DETECTION_CODES.SHALLOW_CLONE
		expect(code1).toBe(code2)
		expect(typeof code1).toBe('string')
	})
})

describe('createDetectionIssue', () => {
	test('creates an issue with all fields populated', () => {
		const issue = createDetectionIssue(
			DETECTION_CODES.SHALLOW_CLONE,
			'error',
			'shallow-guard',
			'shallow clone: detection unavailable',
			false,
		)

		expect(issue.code).toBe('SHALLOW_CLONE')
		expect(issue.severity).toBe('error')
		expect(issue.source).toBe('shallow-guard')
		expect(issue.message).toBe('shallow clone: detection unavailable')
		expect(issue.countsReliable).toBe(false)
	})

	test('creates a warning issue with countsReliable=true', () => {
		const issue = createDetectionIssue(
			DETECTION_CODES.CHERRY_TIMEOUT,
			'warning',
			'layer3-cherry',
			'cherry timed out',
			true,
		)

		expect(issue.severity).toBe('warning')
		expect(issue.countsReliable).toBe(true)
	})

	test('creates an error issue with countsReliable=false', () => {
		const issue = createDetectionIssue(
			DETECTION_CODES.MERGE_BASE_FAILED,
			'error',
			'layer1',
			'merge-base failed: unknown ref',
			false,
		)

		expect(issue.severity).toBe('error')
		expect(issue.countsReliable).toBe(false)
	})

	test('returned object satisfies the DetectionIssue interface shape', () => {
		const issue: DetectionIssue = createDetectionIssue(
			DETECTION_CODES.ENRICHMENT_FAILED,
			'error',
			'enrichment',
			'some error',
			false,
		)

		// All interface fields must be present
		expect('code' in issue).toBe(true)
		expect('severity' in issue).toBe(true)
		expect('source' in issue).toBe(true)
		expect('message' in issue).toBe(true)
		expect('countsReliable' in issue).toBe(true)
	})

	test('each call returns a distinct object', () => {
		const a = createDetectionIssue(
			DETECTION_CODES.CHERRY_FAILED,
			'warning',
			'layer3-cherry',
			'cherry exit code 1',
			true,
		)
		const b = createDetectionIssue(
			DETECTION_CODES.CHERRY_FAILED,
			'warning',
			'layer3-cherry',
			'cherry exit code 1',
			true,
		)

		expect(a).not.toBe(b) // distinct objects
		expect(a).toEqual(b) // same shape/values
	})

	test('accepts arbitrary code strings (not just DETECTION_CODES keys)', () => {
		// The parameter type is string, so callers can pass custom codes.
		const issue = createDetectionIssue(
			'CUSTOM_CODE',
			'warning',
			'custom-source',
			'custom message',
			true,
		)
		expect(issue.code).toBe('CUSTOM_CODE')
	})
})
