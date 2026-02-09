/**
 * Truncate text to a max length with ellipsis when needed.
 */
export function truncateForSubject(text: string, maxLen: number): string {
	if (text.length <= maxLen) {
		return text
	}

	return `${text.slice(0, maxLen - 3)}...`
}
