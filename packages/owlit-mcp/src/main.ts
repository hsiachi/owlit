#!/usr/bin/env node
// owlit-mcp --workspace <folder> [--chat <id>]: owlit's tools over stdio, for an agent. owlit starts it
// for its own agents, with the session secret (OWLIT_SESSION) that tells core which chat it works for;
// --chat only signs its searches and comments. To use it from an agent outside owlit, point
// that agent's MCP config at this command with the workspace owlit has open: it then works as a program
// with no chat, which reads and changes only Owlit's own things.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { connect, OwlitNotRunning } from "@owlit/client"
import { createServer } from "./server.ts"

function flag(name: string) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const workspace = flag("workspace") ?? process.env.OWLIT_WORKSPACE
if (!workspace) {
  console.error("owlit-mcp needs --workspace <folder>: the folder owlit has open.")
  process.exit(2)
}
const socketDir = flag("socket-dir")

// The rules come from owlit itself; without it running, the tools say so when called
async function main(workspace: string) {
  let instructions: string | undefined
  try {
    const owlit = await connect(workspace, { dir: socketDir })
    instructions = await owlit.call("agents.rules").catch(() => undefined)
    owlit.close()
  } catch (error) {
    if (error instanceof OwlitNotRunning) console.error(`owlit-mcp: ${error.message}`)
    else throw error
  }
  const server = createServer({ workspace, socketDir, chatId: flag("chat"), instructions })
  await server.connect(new StdioServerTransport())
  // The agent that started this is gone. The socket to owlit, once a tool used it, would keep the process
  // alive on its own, authenticated, so leave
  process.stdin.on("end", () => process.exit(0))
}

void main(workspace)
