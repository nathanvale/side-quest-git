import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { parseEnvInt } from './env.js'

const TEST_VAR = 'SIDE_QUEST_TEST_PARSE_ENV_INT'

describe('parseEnvInt', () => {
	beforeEach(() => {
		delete process.env[TEST_VAR]
	})

	afterEach(() => {
		delete process.env[TEST_VAR]
	})

	test('returns default when env var is not set', () => {
		expect(parseEnvInt(TEST_VAR, 42)).toBe(42)
	})

	test('returns default when env var is empty string', () => {
		process.env[TEST_VAR] = ''
		expect(parseEnvInt(TEST_VAR, 42)).toBe(42)
	})

	test('parses a valid positive integer', () => {
		process.env[TEST_VAR] = '10'
		expect(parseEnvInt(TEST_VAR, 4)).toBe(10)
	})

	test('throws for NaN (non-numeric string)', () => {
		process.env[TEST_VAR] = 'abc'
		expect(() => parseEnvInt(TEST_VAR, 4)).toThrow(`Invalid environment variable ${TEST_VAR}="abc"`)
	})

	test('throws for zero (default min is 1)', () => {
		process.env[TEST_VAR] = '0'
		expect(() => parseEnvInt(TEST_VAR, 4)).toThrow(`Invalid environment variable ${TEST_VAR}="0"`)
	})

	test('throws for negative value', () => {
		process.env[TEST_VAR] = '-5'
		expect(() => parseEnvInt(TEST_VAR, 4)).toThrow(`Invalid environment variable ${TEST_VAR}="-5"`)
	})

	test('throws when value is below custom min', () => {
		process.env[TEST_VAR] = '500'
		expect(() => parseEnvInt(TEST_VAR, 1000, { min: 1000 })).toThrow(
			`Invalid environment variable ${TEST_VAR}="500"`,
		)
	})

	test('accepts value equal to custom min', () => {
		process.env[TEST_VAR] = '1000'
		expect(parseEnvInt(TEST_VAR, 5000, { min: 1000 })).toBe(1000)
	})

	test('throws for float (non-integer)', () => {
		process.env[TEST_VAR] = '3.14'
		expect(() => parseEnvInt(TEST_VAR, 4)).toThrow(
			`Invalid environment variable ${TEST_VAR}="3.14"`,
		)
	})

	test('accepts min: 0 to allow zero', () => {
		process.env[TEST_VAR] = '0'
		expect(parseEnvInt(TEST_VAR, 1, { min: 0 })).toBe(0)
	})
})
