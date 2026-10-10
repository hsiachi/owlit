// The engine's tools: the MCP servers owlit hands each session (owlit-mcp, and nothing else), connected
// with Pi's MCP client and offered to the model as agent tools. The engine reads nothing of the user's
// own setup, so these are all it has.

import type { McpServer } from "@agentclientprotocol/sdk"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp"
import { Type } from "typebox"
import { kindOf, type ToolInfo } from "./updates.ts"

export interface Toolbox {
  tools: AgentTool[]
  info(name: string): ToolInfo | undefined
  close(): Promise<void>
  // What the servers say about themselves (owlit-mcp's is owlit's rules)
  instructions?: string
}

const VERSION = "0.0.0"

export async function connectTools(servers: McpServer[], cwd: string, log: (line: string) => void): Promise<Toolbox> {
  const clients: McpClient[] = []
  const tools: AgentTool[] = []
  const infos = new Map<string, ToolInfo>()
  for (const server of servers) {
    // owlit only passes owlit-mcp, over stdio
    if ("type" in server) {
      log(`skipped MCP server ${server.name}: only stdio servers are supported`)
      continue
    }
    const stdio = server as Extract<McpServer, { command: string }>
    const client = new McpClient({ name: "owlit-engine", version: VERSION, roots: [{ uri: `file://${cwd}`, name: "workspace" }] })
    await client.connect(new StdioTransport({ command: stdio.command, args: stdio.args, cwd, env: Object.fromEntries(stdio.env.map((e) => [e.name, e.value])), inheritEnv: true, stderr: "pipe" }))
    clients.push(client)
    for (const tool of await client.listTools()) {
      // The model sees a tool by its own name (owlit's rules name them so); a second server's tool of the
      // same name gets its server's name in front
      const name = (infos.has(tool.name) ? `${server.name}_${tool.name}` : tool.name).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
      infos.set(name, { title: `mcp__${server.name}__${tool.name}`, kind: kindOf(tool.name) })
      tools.push({
        name,
        label: tool.title ?? tool.name,
        description: tool.description ?? tool.name,
        // Providers want an object schema with properties
        parameters: Type.Unsafe({ ...tool.inputSchema, type: "object", properties: tool.inputSchema.properties ?? {} }),
        execute: async (_id, params, signal) => {
          const result = await client.callTool(tool.name, params as Record<string, unknown>, { signal })
          // MCP reports a tool's failure in its result; the loop learns of it from a throw
          if (result.isError) throw new Error(toLlmContent(result).map((c) => (c.type === "text" ? c.text : "")).join("\n") || `${tool.name} failed`)
          return { content: toLlmContent(result), details: undefined }
        },
      })
    }
  }
  const instructions = clients.map((c) => c.instructions).filter(Boolean).join("\n\n")
  return {
    tools,
    ...(instructions ? { instructions } : {}),
    info: (name) => infos.get(name),
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)))
    },
  }
}
