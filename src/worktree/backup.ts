/**
 * Backup ref management for branch recovery.
 *
 * Creates refs/backup/<branch> before branch deletion so that deleted
 * branches can be restored without relying on the reflog. This is
 * especially useful in CI environments where reflogs are pruned aggressively.
 *
 * @module worktree/backup
 */

import { spawnAndCollect } from '@side-quest/core/spawn'

/** A backup ref entry returned by listBackupRefs. */
export interface BackupRef {
	/** Original branch name (without refs/backup/ prefix). */
	readonly branch: string
	/** Full commit SHA the ref points to. */
	readonly commit: string
	/** ISO 8601 timestamp when the ref was created (from the reflog). */
	readonly createdAt: string
}

/** Prefix used for all backup refs in the git object store. */
const BACKUP_PREFIX = 'refs/backup/'

/**
 * Sanitize a branch name into a valid ref path component.
 *
 * Why: Branch names like "feat/my-thing" contain slashes, which are valid
 * inside a ref path (refs/backup/feat/my-thing). Git treats slashes as
 * path separators for packed-refs, so this is fine -- we only need to
 * strip characters that are outright illegal in ref names.
 */
function toRefName(branch: string): string {
	return `${BACKUP_PREFIX}${branch}`
}

/**
 * Create a backup ref for a branch before deletion.
 *
 * Why: Once a branch is deleted there is no guaranteed recovery path
 * unless a backup ref is created first. refs/backup/<branch> is outside
 * the normal refs/heads/ namespace so it does not appear in `git branch`
 * listings but is still a fully-valid ref that can be restored from.
 *
 * Uses `git update-ref` which is atomic and works in both normal and
 * bare repositories.
 *
 * @param gitRoot - Main worktree root (directory containing .git)
 * @param branch - Branch name to back up (e.g. "feat/my-thing")
 * @throws If the branch does not exist or git update-ref fails
 */
export async function createBackupRef(
	gitRoot: string,
	branch: string,
): Promise<void> {
	// Resolve the current commit SHA for the branch
	const resolveResult = await spawnAndCollect(
		['git', 'rev-parse', '--verify', branch],
		{ cwd: gitRoot },
	)
	if (resolveResult.exitCode !== 0) {
		throw new Error(
			`Cannot create backup for branch "${branch}": ${resolveResult.stderr.trim() || 'branch not found'}`,
		)
	}

	const commit = resolveResult.stdout.trim()
	const refName = toRefName(branch)

	const updateResult = await spawnAndCollect(
		['git', 'update-ref', refName, commit],
		{ cwd: gitRoot },
	)
	if (updateResult.exitCode !== 0) {
		throw new Error(
			`Failed to create backup ref "${refName}": ${updateResult.stderr.trim()}`,
		)
	}
}

/**
 * List all backup refs in the repository.
 *
 * Why: Operators need visibility into which branches have been backed up
 * and when, to decide what to recover and what to prune.
 *
 * Uses `git for-each-ref` with a format string to get the commit SHA and
 * the creator timestamp from the reflog.
 *
 * @param gitRoot - Main worktree root
 * @returns Array of BackupRef objects sorted oldest-first by createdAt
 */
export async function listBackupRefs(gitRoot: string): Promise<BackupRef[]> {
	// %(creatordate:iso-strict) gives us an ISO 8601 timestamp for when the
	// ref was last updated -- which corresponds to when the backup was created.
	const result = await spawnAndCollect(
		[
			'git',
			'for-each-ref',
			`--format=%(objectname) %(creatordate:iso-strict) %(refname)`,
			BACKUP_PREFIX,
		],
		{ cwd: gitRoot },
	)

	if (result.exitCode !== 0) {
		// No backup refs exist yet -- return empty rather than throwing
		return []
	}

	const lines = result.stdout.trim().split('\n').filter(Boolean)
	const refs: BackupRef[] = []

	for (const line of lines) {
		// Format: "<sha> <iso-date> refs/backup/<branch>"
		// The date itself may not contain spaces (iso-strict), and the refname
		// may contain slashes but not spaces, so splitting on ' ' with a limit
		// of 3 is safe.
		const spaceIdx1 = line.indexOf(' ')
		const spaceIdx2 = line.indexOf(' ', spaceIdx1 + 1)
		if (spaceIdx1 === -1 || spaceIdx2 === -1) continue

		const commit = line.slice(0, spaceIdx1)
		const createdAt = line.slice(spaceIdx1 + 1, spaceIdx2)
		const refname = line.slice(spaceIdx2 + 1)
		const branch = refname.slice(BACKUP_PREFIX.length)

		if (!commit || !createdAt || !branch) continue

		refs.push({ branch, commit, createdAt })
	}

	// Sort oldest-first so callers can easily iterate in creation order
	refs.sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	)

	return refs
}

/**
 * Restore a branch from its backup ref.
 *
 * Why: When a branch was deleted by mistake, the backup ref lets us
 * recreate it pointing to the exact commit it was at before deletion.
 * The backup ref itself is left in place after restore so the operator
 * can confirm the restore was correct before running cleanupBackupRefs.
 *
 * @param gitRoot - Main worktree root
 * @param branch - Branch name to restore (must have a backup ref)
 * @throws If no backup ref exists for the branch, or branch creation fails
 */
export async function restoreBackupRef(
	gitRoot: string,
	branch: string,
): Promise<void> {
	const refName = toRefName(branch)

	// Verify the backup ref exists
	const resolveResult = await spawnAndCollect(
		['git', 'rev-parse', '--verify', refName],
		{ cwd: gitRoot },
	)
	if (resolveResult.exitCode !== 0) {
		throw new Error(`No backup ref found for branch "${branch}"`)
	}

	const commit = resolveResult.stdout.trim()

	// Check if the branch already exists -- refuse to clobber it
	const branchExistsResult = await spawnAndCollect(
		['git', 'rev-parse', '--verify', branch],
		{ cwd: gitRoot },
	)
	if (branchExistsResult.exitCode === 0) {
		throw new Error(
			`Branch "${branch}" already exists -- delete it first before restoring`,
		)
	}

	// Create the branch pointing to the backed-up commit
	const createResult = await spawnAndCollect(
		['git', 'update-ref', `refs/heads/${branch}`, commit],
		{ cwd: gitRoot },
	)
	if (createResult.exitCode !== 0) {
		throw new Error(
			`Failed to restore branch "${branch}" from backup: ${createResult.stderr.trim()}`,
		)
	}
}

/**
 * Clean up backup refs older than maxAgeDays.
 *
 * Why: Backup refs accumulate over time. Without cleanup the git object
 * store grows unbounded and the list becomes unwieldy. The default 30-day
 * window gives operators ample time to notice a missing branch before the
 * backup is pruned.
 *
 * @param gitRoot - Main worktree root
 * @param maxAgeDays - Delete backups older than this many days (default 30)
 * @returns Array of branch names whose backup refs were deleted
 */
export async function cleanupBackupRefs(
	gitRoot: string,
	maxAgeDays = 30,
): Promise<string[]> {
	const refs = await listBackupRefs(gitRoot)
	const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
	const deleted: string[] = []

	for (const ref of refs) {
		const age = new Date(ref.createdAt).getTime()
		if (age < cutoff) {
			const refName = toRefName(ref.branch)
			const result = await spawnAndCollect(
				['git', 'update-ref', '-d', refName],
				{ cwd: gitRoot },
			)
			if (result.exitCode === 0) {
				deleted.push(ref.branch)
			}
		}
	}

	return deleted
}
