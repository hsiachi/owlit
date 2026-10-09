// The tools owlit-mcp gives agents: names, what each does, and its parameters as JSON Schema. Agents
// read the descriptions, so they say what to pass and what comes back.

export interface ToolSpec {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: "string" | "number" | "boolean"; description: string; enum?: string[] }>
    required?: string[]
  }
}

const id = { type: "string" as const, description: "The paper's library id, e.g. doi-10.1145-3626772.3657891 or arxiv-2408.00447" }

export const OWLIT_TOOLS: ToolSpec[] = [
  {
    name: "library_list",
    description:
      "Papers in the user's library: id, title, authors, year, venue, status (unread/reading/read), starred, tags, and whether it has a PDF, full text and a digest. With a query, only papers whose details or full text contain every word, best first. Cite a paper as [Author Year](owlit://library/<id>).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for (optional)" },
        limit: { type: "number", description: "At most this many (default 50)" },
      },
    },
  },
  {
    name: "library_get",
    description: "One paper's details: metadata, abstract, ids, the user's status, star and tags, how many highlights, and whether there is a note or a digest.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "library_read",
    description:
      "Read a paper. part=text is its full text as Markdown with <!-- page N --> before each page: ask for pages ('3', '3-5', '2,7') or a section (a word from its heading) rather than all of it. part=digest is the reading note an agent wrote; part=note is the user's own note.",
    inputSchema: {
      type: "object",
      properties: {
        id,
        part: { type: "string", enum: ["text", "digest", "note"], description: "What to read (default text)" },
        pages: { type: "string", description: "Pages of the text, e.g. '3' or '3-5'" },
        section: { type: "string", description: "A word from a heading; the section under it" },
      },
      required: ["id"],
    },
  },
  {
    name: "library_highlights",
    description: "What the user highlighted in a paper, in reading order: the quote, its page (1-based), colour and their comment.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "library_search",
    description:
      "Search for papers outside the library (OpenAlex): title, authors, year, venue, abstract, ids and citation count, and inLibrary when the user has it already. Adds nothing; use library_add for the ones worth keeping. Every search is recorded.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        limit: { type: "number", description: "How many (default 10, at most 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "library_add",
    description:
      "Add a paper to the user's library, as added by you: a DOI, an arXiv id, a link to the paper, or an id from library_search. Its metadata, PDF and text follow by themselves. Returns its library id.",
    inputSchema: { type: "object", properties: { ref: { type: "string", description: "DOI, arXiv id, link, or library id" } }, required: ["ref"] },
  },
  {
    name: "library_write_digest",
    description:
      "Keep a reading note for a paper you have read (one you just added, say): Markdown starting with '# <title>', then ## Question, ## Method, ## Findings, ## Limitations and ## Why it matters, one to three sentences each. Refused when the paper already has one.",
    inputSchema: {
      type: "object",
      properties: { id, digest: { type: "string", description: "The note, as Markdown" } },
      required: ["id", "digest"],
    },
  },
  {
    name: "docs_list",
    description: "The user's docs: every Markdown file in the workspace (outside library/), with its path.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "docs_read",
    description: "A doc's text, as it is on disk now.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path, e.g. 'drafts/Related work.md'" } }, required: ["path"] },
  },
  {
    name: "docs_add_note",
    description:
      "Leave a note in the margin of the user's doc, attached to a passage, without changing the file. Use this for comments and suggestions instead of editing the doc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the doc" },
        quote: { type: "string", description: "The exact passage the note is about, as it appears in the doc" },
        note: { type: "string", description: "What you want to say" },
      },
      required: ["path", "quote", "note"],
    },
  },
  {
    name: "chats_list",
    description: "The user's chats with owlit, most recent first: id, title, when.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chats_read",
    description: "One chat's messages as text.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The chat's id" } }, required: ["id"] },
  },
]
