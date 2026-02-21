/**
 * Structured error/warning model for the merge detection cascade.
 *
 * Why: A single `detectionError?: string` field is opaque. Consumers
 * can't distinguish severity, source, or whether numeric counts are
 * still trustworthy. `DetectionIssue` makes all of that explicit so
 * callers can take targeted action rather than treating every error
 * as fatal.
 *
 * @module worktree/detection-issue
 */

/**
 * Structured error/warning from the merge detection cascade.
 *
 * Each issue captures which layer failed, how severely, and whether
 * the numeric counts (commitsAhead/Behind) are still trustworthy.
 */
export interface DetectionIssue {
	/** Stable, grep-able error code (e.g., 'SHALLOW_CLONE', 'CHERRY_TIMEOUT') */
	readonly code: string
	/** Whether this is a warning (detection continued) or error (detection stopped) */
	readonly severity: 'warning' | 'error'
	/** Which layer or step produced this issue (e.g., 'layer1', 'layer3-cherry', 'shallow-guard') */
	readonly source: string
	/** Human-readable detail message */
	readonly message: string
	/** Whether commitsAhead/commitsBehind values are trustworthy despite this issue */
	readonly countsReliable: boolean
}

/**
 * Stable error code constants for detection issues.
 *
 * Why: Using constants rather than raw strings makes grep-ability and
 * exhaustive handling possible for callers who want to switch on codes.
 */
export const DETECTION_CODES = {
	SHALLOW_CLONE: 'SHALLOW_CLONE',
	SHALLOW_CHECK_FAILED: 'SHALLOW_CHECK_FAILED',
	MERGE_BASE_FAILED: 'MERGE_BASE_FAILED',
	MERGE_BASE_LOOKUP_FAILED: 'MERGE_BASE_LOOKUP_FAILED',
	CHERRY_TIMEOUT: 'CHERRY_TIMEOUT',
	CHERRY_FAILED: 'CHERRY_FAILED',
	CHERRY_EMPTY: 'CHERRY_EMPTY',
	CHERRY_INVALID: 'CHERRY_INVALID',
	COMMIT_TREE_FAILED: 'COMMIT_TREE_FAILED',
	GIT_PATH_FAILED: 'GIT_PATH_FAILED',
	DETECTION_DISABLED: 'DETECTION_DISABLED',
	ENRICHMENT_FAILED: 'ENRICHMENT_FAILED',
	/**
	 * The caller's AbortSignal fired while a git subprocess in Layer 1 or
	 * Layer 2 was running. The subprocess threw an AbortError, which was
	 * caught by the top-level try/catch in detectMergeStatus and converted
	 * to a graceful return rather than an unhandled exception.
	 */
	DETECTION_ABORTED: 'DETECTION_ABORTED',
} as const

/**
 * Create a structured detection issue.
 *
 * Why: A factory function keeps construction consistent and avoids
 * callers having to assemble the object shape manually every time.
 *
 * @param code - Stable error code from DETECTION_CODES
 * @param severity - 'warning' if detection continued, 'error' if detection stopped
 * @param source - Layer or step that produced this issue
 * @param message - Human-readable detail
 * @param countsReliable - Whether commitsAhead/commitsBehind are trustworthy
 * @returns A fully constructed DetectionIssue
 */
export function createDetectionIssue(
	code: string,
	severity: 'warning' | 'error',
	source: string,
	message: string,
	countsReliable: boolean,
): DetectionIssue {
	return { code, severity, source, message, countsReliable }
}
