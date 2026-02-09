/** Command audit entry shape written to JSONL. */
export interface CommandLogEntry {
	timestamp: string
	session_id: string
	cwd: string
	command: string
}

/** Minimal input shape for command log creation. */
export interface CommandLogParams {
	tool_name: string
	tool_input?: {
		command?: unknown
	}
	session_id?: string
	cwd?: string
}
