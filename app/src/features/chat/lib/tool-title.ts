import type { ToolInfo } from "@owlit/protocol"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { capital } from "@/lib/words"

// What a tool call is called on screen. Agents name owlit's own tools by their MCP name
// (mcp__owlit__library_search from Claude Code, mcp.owlit.library_search from Codex) and a paper's note by its file (library/papers/<id>/note.md, or
// .owlit/papers/<id>/note.md in chats from before 2026-10-13); people shouldn't have to read either, in a chat's steps, its permission card or
// Home's "Waiting on you".
export const OWLIT_TOOLS: Record<string, string> = {
  library_list: "List your Library",
  library_get: "Look up a paper",
  library_read: "Read a paper",
  library_highlights: "Read your highlights",
  library_search: "Search for papers",
  library_related: "Follow a paper's citations",
  library_journal: "List a journal's papers",
  library_add: "Add papers to your Library",
  library_remove: "Remove papers from your Library",
  library_request_digest: "Ask for a digest",
  docs_list: "List your docs",
  docs_read: "Read a doc",
  docs_add_note: "Leave a note on a doc",
  docs_delete: "Delete docs",
  docs_move: "Move a doc",
  chats_list: "List your chats",
  chats_read: "Read a chat",
  knowledge_read: "Read Knowledge",
  knowledge_write: "Update Knowledge",
  ui_open: "Open something in owlit",
  ui_jump: "Show a passage",
  ui_mark: "Highlight a passage",
}

// owlit's own tool a name or title calls, by Claude Code (mcp__owlit__x) or Codex (mcp.owlit.x): "x"
export const owlitToolOf = (name: string) => /^mcp(?:__|\.)owlit(?:__|\.)(\w+)/.exec(name)?.[1]

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 80)}…` : s}”`

// What a step with one of owlit's tools does, with what it is about when the agent's input says (Claude
// Code sends it): seven searches in a row each name their query, instead of reading "Search for papers"
// seven times. Without the input, the tool's plain name.
export function owlitStepTitle(tool: string, info?: ToolInfo): string {
  const plain = OWLIT_TOOLS[tool] ?? capital(tool.replace(/_/g, " "))
  if (!info) return plain
  switch (tool) {
    case "library_search":
      return info.query ? `Search for ${quote(info.query)}` : plain
    case "library_journal":
      return info.subject ? `List the papers in ${quote(info.subject)}` : plain
    case "library_related": {
      // The paper by its label when it is in the Library; an id from a search stays unnamed
      const paper = info.subject ? useLibraryStore.getState().papers[info.subject] : undefined
      return paper ? `Follow ${citationLabel(paper)}'s citations` : plain
    }
  }
  return plain
}

// A paper's note named inside a title
const NOTE_PATH = /(?:\.owlit|library)\/papers\/([^/\s]+)\/note\.md/

export function toolTitle(title: string): string {
  const tool = owlitToolOf(title)
  if (tool) return OWLIT_TOOLS[tool] ?? tool.replace(/_/g, " ")
  const note = NOTE_PATH.exec(title)
  if (note) {
    const paper = useLibraryStore.getState().papers[note[1]]
    return title.replace(NOTE_PATH, paper ? `your note on ${citationLabel(paper)}` : "a paper's note")
  }
  return title
}
