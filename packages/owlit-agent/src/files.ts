// The engine's own file tools. Every read and write goes through ACP's file methods, which owlit serves:
// owlit decides which files an agent may touch, reads an open editor's text rather than the disk, and
// records every write so it can be undone. Nothing here touches the disk itself.
//
// What a role lets the engine do with them:
//   Reviewer   reads only; the edit tools aren't offered
//   Assistant  tells owlit first, with the diff, as a permission request owlit answers at once: the edit
//              lands as a proposal, marked in the doc with Undo per passage, and the chat shows the diff
//   Co-author  writes without asking

import type * as acp from "@agentclientprotocol/sdk"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import path from "node:path"
import { Type } from "typebox"
import type { ToolInfo } from "./updates.ts"

export type Role = "reviewer" | "assistant" | "coauthor"
export const DEFAULT_ROLE: Role = "assistant"

export interface FileContext {
  conn: acp.AgentSideConnection
  sessionId: string
  cwd: string
  role: Role
}

// The edit didn't go through (the turn was stopped while it waited); the model is told so, plainly
class Declined extends Error {}

// oxlint-disable-next-line no-explicit-any -- tools of different parameter types in one list, as the agent holds them
export function fileTools(ctx: FileContext): { tools: AgentTool<any>[]; infos: Map<string, ToolInfo> } {
  const absolute = (p: string) => (path.isAbsolute(p) ? p : path.join(ctx.cwd, p))
  const shown = (p: string) => path.relative(ctx.cwd, absolute(p)) || p
  const read = async (p: string) => (await ctx.conn.readTextFile({ sessionId: ctx.sessionId, path: absolute(p) })).content
  // A file that doesn't exist yet reads as empty, for a new doc
  const readOrEmpty = (p: string) => read(p).catch(() => "")

  // As Assistant, say the change as a diff first (owlit allows it at once and records what is written
  // next as this call's), then write through owlit
  const change = async (toolCallId: string, title: string, p: string, oldText: string, newText: string) => {
    const file = absolute(p)
    if (ctx.role === "assistant") {
      const answer = await ctx.conn.requestPermission({
        sessionId: ctx.sessionId,
        toolCall: { toolCallId, title, kind: "edit", status: "pending", locations: [{ path: file }], content: [{ type: "diff", path: file, oldText, newText }] },
        options: [
          { optionId: "apply", name: "Apply", kind: "allow_once" },
          { optionId: "discard", name: "Discard", kind: "reject_once" },
        ],
      })
      if (answer.outcome.outcome !== "selected" || answer.outcome.optionId !== "apply") throw new Declined(`This change to ${shown(p)} didn't go through. Don't make it another way; ask the user what they want instead.`)
    }
    await ctx.conn.writeTextFile({ sessionId: ctx.sessionId, path: file, content: newText })
  }

  const infos = new Map<string, ToolInfo>([
    ["read_file", { title: (a) => `Read ${shown(String(a?.path ?? ""))}`, kind: "read", locations: (a) => [absolute(String(a?.path ?? ""))] }],
    ["edit_file", { title: (a) => `Edit ${shown(String(a?.path ?? ""))}`, kind: "edit", locations: (a) => [absolute(String(a?.path ?? ""))] }],
    ["write_file", { title: (a) => `Write ${shown(String(a?.path ?? ""))}`, kind: "edit", locations: (a) => [absolute(String(a?.path ?? ""))] }],
  ])

  const readParams = Type.Object({ path: Type.String({ description: "Path relative to the workspace" }) })
  const readFile: AgentTool<typeof readParams> = {
    name: "read_file",
    label: "Read a file",
    description: "Read a text file in the workspace, such as one of the user's Markdown docs, by its path relative to the workspace. Returns the text with line numbers. Read a file right before you edit it.",
    parameters: readParams,
    execute: async (_id, { path: p }) => {
      const text = await read(p)
      const numbered = text.split("\n").map((line, i) => `${String(i + 1).padStart(5)}\t${line}`).join("\n")
      return { content: [{ type: "text", text: numbered }], details: undefined }
    },
  }
  if (ctx.role === "reviewer") return { tools: [readFile], infos }

  const editParams = Type.Object({
    path: Type.String({ description: "Path relative to the workspace" }),
    old_text: Type.String({ description: "The exact text to replace" }),
    new_text: Type.String({ description: "What replaces it" }),
  })
  const editFile: AgentTool<typeof editParams> = {
    name: "edit_file",
    label: "Edit a file",
    description:
      "Change a text file in the workspace by replacing one exact passage. old_text must appear in the file exactly once (copy it from read_file without the line numbers); include enough around it to make it unique." +
      (ctx.role === "assistant" ? " The change lands at once, marked in the doc; the user may undo it, so change one passage per call." : ""),
    parameters: editParams,
    // One change at a time: each is read, shown and written before the next
    executionMode: "sequential",
    execute: async (toolCallId, { path: p, old_text: oldText, new_text: newText }) => {
      const before = await read(p)
      const at = before.indexOf(oldText)
      if (!oldText || at < 0) throw new Error(`old_text isn't in ${shown(p)}. Read the file again and copy the passage exactly.`)
      if (before.indexOf(oldText, at + 1) >= 0) throw new Error(`old_text appears more than once in ${shown(p)}. Include more around it.`)
      const after = before.slice(0, at) + newText + before.slice(at + oldText.length)
      await change(toolCallId, `Edit ${shown(p)}`, p, before, after)
      return { content: [{ type: "text", text: `Changed ${shown(p)}.` }], details: undefined }
    },
  }

  const writeParams = Type.Object({
    path: Type.String({ description: "Path relative to the workspace, ending in .md for a doc" }),
    content: Type.String({ description: "The whole text of the file" }),
  })
  const writeFile: AgentTool<typeof writeParams> = {
    name: "write_file",
    label: "Write a file",
    description:
      "Write a whole text file in the workspace: a new Markdown doc, or a file you are replacing entirely. Prefer edit_file for changes to an existing file." +
      (ctx.role === "assistant" ? " It lands at once, marked in the doc; the user may undo any part." : ""),
    parameters: writeParams,
    executionMode: "sequential",
    execute: async (toolCallId, { path: p, content }) => {
      const before = await readOrEmpty(p)
      await change(toolCallId, `Write ${shown(p)}`, p, before, content)
      return { content: [{ type: "text", text: `Wrote ${shown(p)}.` }], details: undefined }
    },
  }

  return { tools: [readFile, editFile, writeFile], infos }
}
