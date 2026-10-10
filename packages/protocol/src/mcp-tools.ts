// The tools owlit-mcp gives agents: names, what each does, and its parameters as JSON Schema. Agents
// read the descriptions, so they say what to pass and what comes back.

export interface ToolSpec {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: "string" | "number" | "boolean"; description: string; enum?: string[] } | { type: "array"; items: { type: "string" }; description: string }>
    required?: string[]
  }
  // How the agent may treat a call: one that changes nothing the user keeps is read-only
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
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
    name: "docs_delete",
    description:
      "Delete docs or folders of the user's, when they ask for it. Use this, not shell commands: owlit asks the user first when their settings say so, and keeps each file so they can undo it.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" }, description: "Workspace-relative paths of the docs or folders" } },
      required: ["paths"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "docs_move",
    description:
      "Move or rename a doc or folder of the user's, when they ask for it. Use this, not shell commands: owlit asks the user first when their settings say so, and keeps the change so they can undo it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the doc or folder" },
        to: { type: "string", description: "Its new workspace-relative path, name included (e.g. drafts/Related work.md)" },
      },
      required: ["path", "to"],
    },
  },
  {
    name: "ui_open",
    description:
      "Show the user something in their owlit window: a paper (owlit://library/<id>), a doc (owlit://docs/<path>, e.g. owlit://docs/drafts/Related work.md), a chat (owlit://chat/<id>), a Settings section (owlit://settings/<section>) or the shortcut list (owlit://shortcuts). Use it when the user asks to see something, not on your own.",
    inputSchema: { type: "object", properties: { uri: { type: "string", description: "An owlit:// link" } }, required: ["uri"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_jump",
    description:
      "Take the user to a place in a paper or doc in their owlit window: a page of a paper, or a passage, which is ringed in the paper's PDF or selected in the doc. Quote the passage word for word from library_read or docs_read (a sentence or two is enough). Says whether the passage was found.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "owlit://library/<id> or owlit://docs/<path>" },
        quote: { type: "string", description: "The passage, word for word (optional)" },
        page: { type: "number", description: "1-based page of a paper; helps find the passage, or is where to go without one (optional)" },
      },
      required: ["uri"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_mark",
    description:
      "Highlight a passage in a paper's PDF for the user, kept with their own highlights and shown as added by Owlit. Only when the user asks for passages to be marked. Quote the passage word for word from library_read. The user is taken to the highlight, so ui_jump isn't needed after it.",
    inputSchema: {
      type: "object",
      properties: {
        id,
        quote: { type: "string", description: "The passage, word for word" },
        color: { type: "string", description: "Highlight color (default yellow)", enum: ["yellow", "green", "blue", "pink"] },
      },
      required: ["id", "quote"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "knowledge_read",
    description:
      "The user's Knowledge: topic files Owlit keeps of what the user has come to understand, each line said by You, Owlit or a paper. Without a topic, lists the topics and shows the file format; with one, gives its file and the lines the user rewrote (keep them word for word) or removed (never bring them back).",
    inputSchema: { type: "object", properties: { topic: { type: "string", description: "A topic's id or name (optional)" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "knowledge_write",
    description:
      "Write a whole topic file, new or changed. owlit checks it and refuses with what to fix: every line starts with its speaker; ids stay; at most 7 Understanding lines of 30 words, 5 questions and a two-sentence summary; the user's rewritten lines stay word for word and removed ones stay out; a line that speaks for a paper cites owlit://library/<id>#passage=<name>, with that passage quoted word for word in passages.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic's id or name; a new name starts a new topic" },
        content: { type: "string", description: "The whole file, as knowledge_read shows the format" },
        why: { type: "string", description: "Why, in the user's terms: “you highlighted two passages of Lewis et al. 2020”" },
        remove: { type: "string", description: "Ids of lines or questions removed on purpose, comma-separated (optional)" },
        passages: {
          type: "string",
          description: 'JSON array of the passages cited: [{"id": "rag-token", "paper": "arxiv-2005.11401", "quote": "In the RAG-Token model we can draw…", "section": "§2.1"}] (optional)',
        },
      },
      required: ["topic", "content", "why"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "owlit_help",
    description:
      "How to use owlit, for when the user asks about owlit itself (adding papers, getting PDFs, highlighting, citing, docs, Knowledge, undoing Owlit's changes, settings, shortcuts). Without a topic, lists the topics; with one, gives it, with how to link the user to a Settings section.",
    inputSchema: { type: "object", properties: { topic: { type: "string", description: "A topic from the list, or a word to look for (optional)" } } },
    annotations: { readOnlyHint: true },
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
