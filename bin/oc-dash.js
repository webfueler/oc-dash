#!/usr/bin/env node
// Launcher. The CLI itself is TypeScript in server/cli.ts,
// compiled to dist-server/cli.js by `tsc -p tsconfig.server.json`, so it is
// typechecked and unit-tested like every other module in this package and
// ships with the same NodeNext + explicit .js extension convention. This file
// stays two lines of plumbing because it is the published `bin` entry and
// has to keep working under plain node with no build step of its own.
import { run } from "../dist-server/cli.js"

process.exitCode = await run(process.argv.slice(2))
