/**
 * Environment variable parsing utilities for the worktree module.
 *
 * Why: Bare `Number()` calls on env vars silently accept NaN, zero, and
 * negative values. Zero is especially dangerous: `SIDE_QUEST_CONCURRENCY=0`
 * causes an infinite loop in `processInParallelChunks` because chunkSize=0
 * means `i += 0` never advances. These helpers validate eagerly and throw
 * with clear messages so misconfiguration is immediately visible.
 *
 * @module worktree/env
 */

/** Options for parseEnvInt. */
export interface ParseEnvIntOptions {
	/**
	 * Inclusive minimum value.
	 *
	 * Why: Many env vars (timeouts, concurrency, ports) have a meaningful lower
	 * bound. Specifying it here produces a targeted error message rather than a
	 * generic "invalid value" message.
	 */
	readonly min?: number
}

/**
 * Parse an environment variable as a positive integer with validation.
 *
 * Rejects NaN, zero, negative values, and non-integer strings. Returns the
 * `defaultValue` when the variable is not set (undefined or empty string).
 *
 * Why: Raw `Number(process.env.X)` silently accepts NaN and zero, which can
 * cause subtle failures (e.g. zero concurrency causes an infinite loop in
 * processInParallelChunks; NaN timeouts skip safety nets entirely).
 *
 * @param name - Environment variable name (used in error messages)
 * @param defaultValue - Fallback value when the variable is absent
 * @param options - Optional validation constraints (e.g. min value)
 * @returns The parsed integer, or defaultValue if the variable is not set
 * @throws {Error} If the variable is set but invalid (NaN, zero, negative, or below min)
 *
 * @example
 * const concurrency = parseEnvInt('SIDE_QUEST_CONCURRENCY', 4, { min: 1 })
 * const timeoutMs   = parseEnvInt('SIDE_QUEST_ITEM_TIMEOUT_MS', 10000, { min: 1 })
 */
export function parseEnvInt(
	name: string,
	defaultValue: number,
	options: ParseEnvIntOptions = {},
): number {
	const raw = process.env[name]

	// Not set or empty -- use default
	if (raw === undefined || raw === '') {
		return defaultValue
	}

	const value = Number(raw)

	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error(
			`Invalid environment variable ${name}="${raw}": expected a positive integer, got NaN or non-integer`,
		)
	}

	const effectiveMin = options.min ?? 1

	if (value < effectiveMin) {
		throw new Error(
			`Invalid environment variable ${name}="${raw}": value must be >= ${effectiveMin} (got ${value})`,
		)
	}

	return value
}
