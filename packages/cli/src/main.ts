#!/usr/bin/env node
// owlit <command>: see cli.ts. Installed from the app's menu (Owlit › Install Command Line Tool…) as a
// script that runs this file with the app's own Node.

import { run } from "./cli.ts"

run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(`owlit: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)
