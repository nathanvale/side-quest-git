import { CliError } from './errors.js'

const FIELD_PATH_PATTERN = /^[A-Za-z0-9._-]+$/
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Validate `--fields` paths.
 *
 * Why: Restricting field syntax prevents ambiguous parsing and
 * prototype-pollution style path writes.
 */
export function validateFieldPaths(fields: readonly string[]): void {
	for (const field of fields) {
		if (!FIELD_PATH_PATTERN.test(field)) {
			throw CliError.usage(
				`Invalid --fields entry "${field}": expected alphanumeric path segments separated by dots`,
			)
		}
		for (const segment of field.split('.')) {
			if (FORBIDDEN_SEGMENTS.has(segment)) {
				throw CliError.usage(
					`Invalid --fields entry "${field}": forbidden path segment "${segment}"`,
				)
			}
		}
	}
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getValueAtPath(source: unknown, path: string): unknown {
	const segments = path.split('.')
	let cursor: unknown = source

	for (const segment of segments) {
		if (!isJsonObject(cursor)) {
			return undefined
		}
		if (!(segment in cursor)) {
			return undefined
		}
		cursor = cursor[segment]
	}

	return cursor
}

function setValueAtPath(
	target: JsonObject,
	path: string,
	value: unknown,
): void {
	const segments = path.split('.')
	let cursor: JsonObject = target

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i]!
		if (i === segments.length - 1) {
			cursor[segment] = value
			return
		}

		const existing = cursor[segment]
		if (!isJsonObject(existing)) {
			cursor[segment] = {}
		}
		cursor = cursor[segment] as JsonObject
	}
}

function projectObject(source: unknown, fields: readonly string[]): JsonObject {
	const projected: JsonObject = {}

	for (const field of fields) {
		const value = getValueAtPath(source, field)
		if (value !== undefined) {
			setValueAtPath(projected, field, value)
		}
	}

	return projected
}

function projectCollectionFallback(
	data: JsonObject,
	fields: readonly string[],
): unknown[] | undefined {
	for (const value of Object.values(data)) {
		if (!Array.isArray(value)) {
			continue
		}

		const projected = value.map((entry) => projectObject(entry, fields))
		const hasSignal = projected.some((entry) => Object.keys(entry).length > 0)
		if (hasSignal) {
			return projected
		}
	}

	return undefined
}

/**
 * Project arbitrary command output down to requested fields.
 *
 * Why: `--fields` lets agents reduce token usage by selecting only
 * the data they actually consume.
 */
export function projectFields(
	data: unknown,
	fields: readonly string[] | undefined,
): unknown {
	if (!fields || fields.length === 0) {
		return data
	}

	validateFieldPaths(fields)

	if (Array.isArray(data)) {
		return data.map((entry) => projectObject(entry, fields))
	}

	if (!isJsonObject(data)) {
		return data
	}

	const projectedRoot = projectObject(data, fields)
	if (Object.keys(projectedRoot).length > 0) {
		return projectedRoot
	}

	return projectCollectionFallback(data, fields) ?? projectedRoot
}
