// Claude Code PreToolUse hook for Bash: owlit is a pnpm workspace, and npm, npx or yarn would write a
// second lockfile or fetch packages from the registry outside it. Exit 2 blocks the call and shows the
// message to the agent.
import { readFileSync } from "node:fs"

const { tool_input } = JSON.parse(readFileSync(0, "utf8"))
const command = tool_input?.command ?? ""
const found = command.match(/(?:^|[\s;&|(`$])(npm|npx|yarn)(?=\s|$)/)
if (found) {
  const instead = found[1] === "npx" ? "pnpm exec (or pnpm dlx for a package that isn't installed)" : "pnpm"
  process.stderr.write(`owlit uses pnpm only: run ${instead} instead of ${found[1]}.\n`)
  process.exit(2)
}
