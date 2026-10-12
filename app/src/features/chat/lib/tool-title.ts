import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"

// What a tool call is called on screen. Agents name owlit's own tools by their MCP name
// (mcp__owlit__library_search from Claude Code, mcp.owlit.library_search from Codex) and a paper's note by its file (.owlit/papers/<id>/note.md); people
// shouldn't have to read either, in a chat's steps, its permission card or Home's "Waiting on you".
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
  library_write_digest: "Write a reading summary",
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

// A paper's note named inside a title
const NOTE_PATH = /\.owlit\/papers\/([^/\s]+)\/note\.md/

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
