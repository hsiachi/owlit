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
    description:
      "One paper's details: metadata, abstract, ids, the user's status, star and tags, how many highlights, and whether there is a note or a digest. Also takes an id a search gave for a paper outside the library, and then gives its whole abstract, which the search's line cuts short.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "library_read",
    description:
      "Read a paper. part=text is its full text as Markdown with <!-- page N --> before each page: ask for pages ('3', '3-5', '2,7') or a section (a word from its heading) rather than all of it. part=digest is the digest an agent wrote; part=note is the user's own note.",
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
    name: "library_remove",
    description:
      "Take back papers you added in this chat with library_add: one added by mistake, or a copy of a paper the library already has. Only those, and only while the user hasn't starred, tagged, highlighted or written about them; any other paper is the user's, so name it in your answer and let them decide. The user can undo each removal.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, description: "Library ids of papers you added" } },
      required: ["ids"],
    },
  },
  {
    name: "library_request_digest",
    description:
      "Have Owlit write a digest for a paper (one you just added, say): it reads the full text and its figures in the background, in the user's language, and the digest appears on the paper's page. Nothing happens when the paper already has one. Read one with library_read part=digest.",
    inputSchema: {
      type: "object",
      properties: { id },
      required: ["id"],
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
    name: "collection_list",
    description:
      "The collections Owlit keeps for the user: papers gathered for a question, with what each says about it. Each line: id, title, the project it belongs to, how many papers and columns, and the question as the user asked it. Look here before you start one: when the user asks something close to a collection's question, add to that collection rather than starting another.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "collection_read",
    description:
      "One collection as the user sees it: its question, columns, groups, memo (sentences with their ids) and every paper with its answers, each marked abstract or full text. Also what the user rewrote (keep it) and removed (never bring it back).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The collection's id" } }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "collection_write",
    description:
      "Gather papers you found into a collection, new (no id) or existing, instead of adding them to the library: the user sees it under Collections and decides what to keep. A paper is named by the id library_search, library_related or library_journal gave; owlit fills in what it is. Each row's answer says in one plain sentence what that paper found about the question, from its whole abstract (library_get gives it; a search's line cuts it short) (depth abstract) or from its full text (depth full, with the words it rests on in quote, word for word as library_read gives them; only papers in the library have full text). The memo is at most four sentences on what the papers say together: agreements, disagreements, what is missing and where you looked. It describes the papers; it doesn't tell the user what to write or conclude. Name papers in it as [Author Year](owlit://library/<id>). The user's rewrites stay and their removals stay out whatever you write. Says the collection's link.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "An existing collection's id; leave out to start one" },
        asked: { type: "string", description: "The user's question in their own words: needed to start one, and given too when you add to one for a new question" },
        title: { type: "string", description: "A short neutral title for what it gathers, in the user's language, naming the topic rather than repeating the question: 回放式标注作为研究方法, not 我的研究方法该怎么设计？ (needed to start one)" },
        project: { type: "string", description: "The workspace's top-level folder the work belongs to, when it plainly belongs to one (optional)" },
        sources: { type: "array", items: { type: "string" }, description: "Where you looked: Semantic Scholar, OpenAlex, arXiv, a journal's issues… (optional)" },
        rows: {
          type: "string",
          description:
            'JSON array of papers to add or update: [{"id": "doi-10.1145-…", "answer": "Replay ratings were 0.6 points lower than live ones.", "depth": "abstract"}, {"id": "arxiv-2408.00447", "answer": "…", "depth": "full", "quote": "words from the text", "group": "eval"}]. Answers for other columns go in "cells": {"<column id>": {"text": "…", "depth": "abstract"}}.',
        },
        memo: {
          type: "string",
          description: 'JSON array of the whole memo as it should be now, at most four sentences: [{"id": "s1", "text": "…"}, {"text": "a new sentence"}]. Keep a sentence\'s id when you keep or reword it. (optional)',
        },
        groups: {
          type: "string",
          description: 'JSON array of the whole grouping, for many papers: [{"id": "eval", "name": "Evaluating proactive systems", "one": "replay, in-situ and benchmark ground truth", "parent": "…"}] (optional)',
        },
        columns: { type: "array", items: { type: "string" }, description: "New questions to ask of every paper, each becoming a column (optional)" },
        remove_rows: { type: "array", items: { type: "string" }, description: "Ids of papers you take out again (optional)" },
        why: { type: "string", description: "One plain sentence on what this write did, for the collection's history (optional)" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "owlit_help",
    description:
      "How to use owlit, for when the user asks about owlit itself (adding papers, getting PDFs, highlighting, citing, docs, collections, undoing Owlit's changes, settings, shortcuts). Without a topic, lists the topics; with one, gives it, with how to link the user to a Settings section.",
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
