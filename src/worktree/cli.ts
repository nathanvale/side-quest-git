#!/usr/bin/env bun

export { runCli } from './cli/index.js'

import { runCli } from './cli/index.js'

if (import.meta.main) {
	void runCli()
}
