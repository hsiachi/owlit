import { t } from "@lingui/core/macro"
import type { ToolInfo } from "@owlit/protocol"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { capital, shorten } from "@/lib/words"

// What a tool call is called on screen. Agents name owlit's own tools by their MCP name
// (mcp__owlit__library_search from Claude Code, mcp.owlit.library_search from Codex) and a paper's note by its file (library/papers/<id>/note.md, or
// .owlit/papers/<id>/note.md in chats from before 2026-10-13); people shouldn't have to read either, in a chat's steps, its permission card or
// Home's "Waiting on you".

// One of owlit's tools as it is about to run or runs ("List your Library") and once it ran ("Listed your
// Library"). Each form is its own message: a language puts tense its own way, not by changing a verb.
// Where English says both alike ("Read a paper"), the done form has a context so it can differ.
export interface ToolWords {
  now: string
  done: string
}

function owlitToolWords(tool: string): ToolWords | undefined {
  switch (tool) {
    case "library_list":
      return { now: t`List your Library`, done: t`Listed your Library` }
    case "library_get":
      return { now: t`Look up a paper`, done: t`Looked up a paper` }
    case "library_read":
      return { now: t`Read a paper`, done: t({ message: "Read a paper", context: "a step that ran" }) }
    case "library_highlights":
      return { now: t`Read your highlights`, done: t({ message: "Read your highlights", context: "a step that ran" }) }
    case "library_search":
      return { now: t`Search for papers`, done: t`Searched for papers` }
    case "library_related":
      return { now: t`Follow a paper's citations`, done: t`Followed a paper's citations` }
    case "library_journal":
      return { now: t`List a journal's papers`, done: t`Listed a journal's papers` }
    case "library_add":
      return { now: t`Add papers to your Library`, done: t`Added papers to your Library` }
    case "library_remove":
      return { now: t`Remove papers from your Library`, done: t`Removed papers from your Library` }
    case "library_request_digest":
      return { now: t`Ask for a digest`, done: t`Asked for a digest` }
    case "docs_list":
      return { now: t`List your docs`, done: t`Listed your docs` }
    case "docs_read":
      return { now: t`Read a doc`, done: t({ message: "Read a doc", context: "a step that ran" }) }
    case "docs_add_note":
      return { now: t`Leave a note on a doc`, done: t`Left a note on a doc` }
    case "docs_delete":
      return { now: t`Delete docs`, done: t`Deleted docs` }
    case "docs_move":
      return { now: t`Move a doc`, done: t`Moved a doc` }
    case "memory_write":
      return { now: t`Keep something in mind`, done: t`Kept something in mind` }
    case "chats_list":
      return { now: t`List your chats`, done: t`Listed your chats` }
    case "chats_read":
      return { now: t`Read a chat`, done: t({ message: "Read a chat", context: "a step that ran" }) }
    case "thread_list":
      return { now: t`List your threads`, done: t`Listed your threads` }
    case "thread_read":
      return { now: t`Read a thread`, done: t({ message: "Read a thread", context: "a step that ran" }) }
    case "thread_write":
      return { now: t`Gather papers into a thread`, done: t`Gathered papers into a thread` }
    case "ui_open":
      return { now: t`Open something in owlit`, done: t`Opened something in owlit` }
    case "ui_jump":
      return { now: t`Show a passage`, done: t`Showed a passage` }
    case "ui_mark":
      return { now: t`Highlight a passage`, done: t`Highlighted a passage` }
  }
  return undefined
}

// A tool owlit has no words for, by its own name ("snippet_search" → "Snippet search"), the same in both forms
const plainWords = (tool: string): ToolWords => {
  const name = capital(tool.replace(/_/g, " "))
  return { now: name, done: name }
}

// owlit's own tool a name or title calls, by Claude Code (mcp__owlit__x) or Codex (mcp.owlit.x): "x"
export const owlitToolOf = (name: string) => /^mcp(?:__|\.)owlit(?:__|\.)(\w+)/.exec(name)?.[1]

export const quote = (s: string) => `“${shorten(s, 80)}”`

// What a step with one of owlit's tools does, with what it is about when the agent's input says (Claude
// Code sends it): seven searches in a row each name their query, instead of reading "Search for papers"
// seven times. Without the input, the tool's plain name.
export function owlitStepWords(tool: string, info?: ToolInfo): ToolWords {
  const plain = owlitToolWords(tool) ?? plainWords(tool)
  if (!info) return plain
  switch (tool) {
    case "library_search": {
      if (!info.query) return plain
      const query = quote(info.query)
      return { now: t`Search for ${query}`, done: t`Searched for ${query}` }
    }
    case "library_journal": {
      if (!info.subject) return plain
      const journal = quote(info.subject)
      return { now: t`List the papers in ${journal}`, done: t`Listed the papers in ${journal}` }
    }
    case "library_related": {
      // The paper by its label when it is in the Library; an id from a search stays unnamed
      const known = info.subject ? useLibraryStore.getState().papers[info.subject] : undefined
      if (!known) return plain
      const paper = citationLabel(known)
      return { now: t`Follow ${paper}'s citations`, done: t`Followed ${paper}'s citations` }
    }
  }
  return plain
}

// A paper's note named inside a title
const NOTE_PATH = /(?:\.owlit|library)\/papers\/([^/\s]+)\/note\.md/

// A step's title as it would run ("List your Library", "Edit your note on Niu et al. 2023"). A title the
// agent wrote stays in its words; only owlit's own names in it are put in the interface's.
export function toolTitle(title: string): string {
  const tool = owlitToolOf(title)
  if (tool) return (owlitToolWords(tool) ?? { now: tool.replace(/_/g, " ") }).now
  const note = NOTE_PATH.exec(title)
  if (note) {
    const known = useLibraryStore.getState().papers[note[1]]
    const paper = known ? citationLabel(known) : undefined
    return title.replace(NOTE_PATH, paper ? t`your note on ${paper}` : t`a paper's note`)
  }
  return title
}
