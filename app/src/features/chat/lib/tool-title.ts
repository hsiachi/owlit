import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"

// What a tool call is called on screen. Agents name owlit's own tools by their MCP name
// (mcp__owlit__library_search) and a paper's note by its file (.owlit/papers/<id>/note.md); people
// shouldn't have to read either, in a chat's steps, its permission card or Home's "Waiting on you".
const OWLIT_TOOLS: Record<string, string> = {
  library_list: "List your Library",
  library_get: "Look up a paper",
  library_read: "Read a paper",
  library_highlights: "Read your highlights",
  library_search: "Search for papers",
  library_add: "Add a paper to your Library",
  library_write_digest: "Write a reading summary",
  docs_list: "List your docs",
  docs_read: "Read a doc",
  docs_add_note: "Leave a note on a doc",
  chats_list: "List your chats",
  chats_read: "Read a chat",
  knowledge_read: "Read Knowledge",
  knowledge_write: "Update Knowledge",
  ui_open: "Open something in owlit",
  ui_jump: "Show a passage",
  ui_mark: "Highlight a passage",
}

const NOTE_PATH = /\.owlit\/papers\/([^/\s]+)\/note\.md/

export function toolTitle(title: string): string {
  const tool = /^mcp__owlit__(\w+)/.exec(title)
  if (tool) return OWLIT_TOOLS[tool[1]] ?? tool[1].replace(/_/g, " ")
  const note = NOTE_PATH.exec(title)
  if (note) {
    const paper = useLibraryStore.getState().papers[note[1]]
    return title.replace(NOTE_PATH, paper ? `your note on ${citationLabel(paper)}` : "a paper's note")
  }
  return title
}
