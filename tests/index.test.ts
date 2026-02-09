import { describe, expect, test } from 'bun:test'
import * as gitLib from '../src/index.js'

describe('library exports', () => {
	test('exports key modules', () => {
		expect(typeof gitLib.createWorktree).toBe('function')
		expect(typeof gitLib.checkCommand).toBe('function')
		expect(typeof gitLib.getGitContext).toBe('function')
		expect(typeof gitLib.extractFromTranscript).toBe('function')
	})
})
