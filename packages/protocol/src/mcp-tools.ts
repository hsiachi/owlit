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
      "Search for papers outside the library: id, title, authors, year, venue, citation count, whether a free PDF is known, a one-line summary or the abstract, and whether the user has it already. One source per search, each with its own strengths: openalex (default; everything, all filters), s2 (Semantic Scholar: better ranking and one-line summaries; filters year, min_citations, type, venue, open_access; slow without an API key) and arxiv (preprints; filters year, author, sort newest; a query with ':' is arXiv's own syntax, e.g. 'cat:cs.CL AND au:Manning'). A filter the source can't apply is refused, not ignored. Adds nothing; use library_add for the ones worth keeping. Every search is recorded.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        source: { type: "string", enum: ["openalex", "s2", "arxiv"], description: "Where to look (default openalex)" },
        year: { type: "string", description: "Publication year: 2023, 2019-2023, 2023- or -2023 (optional)" },
        sort: { type: "string", enum: ["relevance", "citations", "newest"], description: "Order (default relevance)" },
        min_citations: { type: "number", description: "Only papers cited at least this often (optional)" },
        type: { type: "string", enum: ["article", "review", "preprint", "book"], description: "Only this kind; article is a journal or conference paper (optional)" },
        author: { type: "string", description: "An author's name (optional)" },
        venue: { type: "string", description: "A journal or conference by name, e.g. CHI (optional)" },
        open_access: { type: "boolean", description: "Only papers with a free full text (optional)" },
        limit: { type: "number", description: "How many (default 10, at most 50)" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "library_related",
    description:
      "A paper's neighbours, to follow a topic through citations: references (what it cites), cited_by (what cites it; sort newest for recent follow-ups, citations for the influential ones) or similar (Semantic Scholar's recommendations, computer science). The paper can be in the library or not: a library id, an id from library_search, a DOI or an arXiv id. Same lines as library_search. Adds nothing.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The paper: library id, an id from library_search, a DOI or an arXiv id" },
        kind: { type: "string", enum: ["references", "cited_by", "similar"], description: "Which neighbours" },
        year: { type: "string", description: "Publication year: 2023, 2019-2023, 2023- or -2023 (optional)" },
        sort: { type: "string", enum: ["relevance", "citations", "newest"], description: "Order (default: as the source gives them; not for similar)" },
        limit: { type: "number", description: "How many (default 20, at most 100)" },
      },
      required: ["id", "kind"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "library_journal",
    description:
      "Every research article a journal published in a year or a few years, from Crossref's full list, in issue order: for going through a journal rather than searching it. A year counts by the date the publisher registered, for most the issue's: an article online in late 2024 but in a January 2025 issue is in 2025. Journals only: a conference's proceedings (CHI, CSCW, …) can't be listed yet; for those use library_search with venue. With a query, only articles whose title or abstract has every word; a word matches inside longer ones ('recommend' finds recommender and recommendation). Some publishers (Elsevier) give no abstracts, so for them only titles match. Long lists come a page at a time (offset). Adds nothing.",
    inputSchema: {
      type: "object",
      properties: {
        journal: { type: "string", description: "The journal's name or ISSN, e.g. 'Information Processing & Management' or 0306-4573" },
        year: { type: "string", description: "2024, or a range of at most five years: 2022-2024" },
        query: { type: "string", description: "Words that must all be in the title or abstract (optional)" },
        offset: { type: "number", description: "Skip this many, for the next page (default 0)" },
        limit: { type: "number", description: "How many (default 50, at most 200)" },
      },
      required: ["journal", "year"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "library_add",
    description:
      "Add papers to the user's library, as added by you: DOIs, arXiv ids, links to papers, or ids from library_search, library_related or library_journal; several in one call. Their metadata, PDFs and text follow by themselves. Says the library id of each.",
    inputSchema: {
      type: "object",
      properties: { refs: { type: "array", items: { type: "string" }, description: "DOIs, arXiv ids, links, or ids from a search" } },
      required: ["refs"],
    },
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
    description:
      "A doc's text, as it is on disk now. Also reads a PDF in the workspace that isn't in the Library (one the user attached or keeps among their docs): its text comes page by page after <!-- page N --> lines, so cite those page numbers. A PDF in the Library is read with library_read instead.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path, e.g. 'drafts/Related work.md' or 'reviews/round1.pdf'" },
        pages: { type: "string", description: "For a PDF: only these pages, e.g. '3-5' or '1,4'" },
      },
      required: ["path"],
    },
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
