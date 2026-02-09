import { describe, expect, test } from 'bun:test'
import { createLogEntry } from '../src/index.js'

describe('createLogEntry', () => {
	const baseInput = {
		tool_name: 'Bash',
		tool_input: { command: 'git status' },
		session_id: 'test-session-123',
		cwd: '/home/user/project',
	}

	test('creates entry for Bash command', () => {
		const entry = createLogEntry(baseInput)
		expect(entry).not.toBeNull()
		expect(entry?.command).toBe('git status')
		expect(entry?.session_id).toBe('test-session-123')
	})

	test('returns null for non-Bash tool', () => {
		expect(createLogEntry({ ...baseInput, tool_name: 'Read' })).toBeNull()
	})

	test('returns null when command missing', () => {
		expect(createLogEntry({ ...baseInput, tool_input: {} })).toBeNull()
	})

	test('fills unknown defaults', () => {
		const entry = createLogEntry({
			tool_name: 'Bash',
			tool_input: { command: 'git status' },
		})
		expect(entry?.session_id).toBe('unknown')
		expect(entry?.cwd).toBe('unknown')
	})
})
