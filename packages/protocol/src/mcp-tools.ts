import { roleLine, type Touches } from "./roles.ts"

// The tools owlit-mcp gives agents: names, what each does, and its parameters as JSON Schema. Agents
// read the descriptions, so they say what to pass and what comes back. A tool is a projection of core's
// methods: it carries the class they touch (Touches) only to say in its description what each role gets;
// core decides.

export interface ToolSpec {
  name: string
  description: string
  touches: Touches
  inputSchema: {
    type: "object"
    properties: Record<string, { type: "string" | "number" | "boolean"; description: string; enum?: string[] } | { type: "array"; items: { type: "string" }; description: string }>
    required?: string[]
  }
  // How the agent may treat a call: one that changes nothing the user keeps is read-only
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

const id = { type: "string" as const, description: "The paper's library id, e.g. doi-10.1145-3626772.3657891 or arxiv-2408.00447" }
const docPath = { type: "string" as const, description: "Workspace-relative path of the doc" }
const commentId = { type: "string" as const, description: "The comment's id, as docs_comments lists it" }

// Each description ends with what the roles get, from the table the policy decides by
export const OWLIT_TOOLS: ToolSpec[] = TOOLS().map((t) => {
  const line = roleLine(t.touches)
  return line ? { ...t, description: `${t.description} ${line}` } : t
})

function TOOLS(): ToolSpec[] {
  return [
  {
    name: "library_list",
    touches: "read",
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
    touches: "read",
    description:
      "One paper's details: metadata, abstract, ids, the user's status, star and tags, how many highlights, and whether there is a note or a digest. Also takes an id a search gave for a paper outside the library, and then gives its whole abstract, which the search's line cuts short.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "library_read",
    touches: "read",
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
    touches: "read",
    description: "What the user highlighted in a paper, in reading order: the quote, its page (1-based), colour and their comment.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "library_search",
    touches: "read",
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
    touches: "read",
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
    touches: "read",
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
    touches: "meta",
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
    touches: "own",
    description:
      "Take back papers you added with library_add: one added by mistake, or a copy of a paper the library already has. Only those, and only while the user hasn't starred, tagged, highlighted or written about them; any other paper is the user's, so name it in your answer and let them decide. The user can undo each removal.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, description: "Library ids of papers you added" } },
      required: ["ids"],
    },
  },
  {
    name: "library_update",
    touches: "meta",
    description:
      "Star, unstar, tag or set the reading status of papers in the user's library, when they ask for it (\"tag these as baselines\", \"mark the ones I finished as read\"). Tags replace the paper's tags, so pass the whole list. The paper's details (title, authors, year) are the user's to correct, so they aren't here. owlit records each change so the user can undo it.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Library ids of the papers" },
        starred: { type: "boolean", description: "Star (true) or unstar (false) (optional)" },
        status: { type: "string", enum: ["unread", "reading", "read"], description: "The reading status (optional)" },
        tags: { type: "array", items: { type: "string" }, description: "The whole list of tags the papers should have (optional)" },
      },
      required: ["ids"],
    },
  },
  {
    name: "library_unmark",
    touches: "own",
    description: "Remove a highlight you made with ui_mark: the paper and the passage word for word as you marked it. Only your own highlights; the user's are theirs.",
    inputSchema: {
      type: "object",
      properties: { id, quote: { type: "string", description: "The highlighted passage, word for word" } },
      required: ["id", "quote"],
    },
  },
  {
    name: "library_request_digest",
    touches: "own",
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
    touches: "read",
    description: "The user's docs: every Markdown file in the workspace (outside library/), with its path.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "docs_read",
    touches: "read",
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
    name: "docs_add_comment",
    touches: "own",
    description:
      "Leave a comment on a passage of the user's doc, shown beside it, without changing the file. Use this for remarks, questions and suggestions instead of editing the doc. One comment per passage. A claim about a paper cites it with the sentence it rests on as the link's title: [Author Year](owlit://library/<id>#p<page> \"sentence\").",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path of the doc" },
        quote: { type: "string", description: "The exact passage the comment is about, as it appears in the doc" },
        comment: { type: "string", description: "What you want to say" },
        own: {
          type: "string",
          description: "Only when the comment carries over what someone else said (going through a meeting or reviews): your own word on it, kept as a separate entry under it. Leave it out otherwise.",
        },
      },
      required: ["path", "quote", "comment"],
    },
  },
  {
    name: "docs_comments",
    touches: "read",
    description: "The comments on a doc, open ones first: each with its id, the passage it is on, who wrote each entry (the user or Owlit) and what they said, and whether it is resolved. Look here before replying to or resolving one.",
    inputSchema: { type: "object", properties: { path: docPath }, required: ["path"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "comments_reply",
    touches: "meta",
    description:
      "Reply under a comment on a doc, yours or the user's: an entry of your own at the end of it. Use it when the user asks you about one of their comments or replies under one of yours; answer there, not only in the chat. The user's entries are never changed. Under your own comment it is allowed in every role.",
    inputSchema: {
      type: "object",
      properties: { path: docPath, id: commentId, text: { type: "string", description: "Your reply" } },
      required: ["path", "id", "text"],
    },
  },
  {
    name: "comments_resolve",
    touches: "meta",
    description:
      "Resolve a comment on a doc with a reply saying what you did about it. Only once you made the change the comment asked for, in the same turn; a comment you merely answered stays open for the user to resolve. The user can reopen it with Undo.",
    inputSchema: {
      type: "object",
      properties: { path: docPath, id: commentId, reply: { type: "string", description: "What you did about it, as the comment's last entry" } },
      required: ["path", "id", "reply"],
    },
  },
  {
    name: "comments_remove",
    touches: "own",
    description: "Take back a comment of your own on a doc, one you left by mistake or that no longer applies. Only your own comments, and only while the user hasn't replied under it; theirs are theirs.",
    inputSchema: { type: "object", properties: { path: docPath, id: commentId }, required: ["path", "id"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "docs_delete",
    touches: "structure",
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
    touches: "structure",
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
    touches: "read",
    description:
      "Show the user something in their owlit window: a paper (owlit://library/<id>), a doc (owlit://docs/<path>, e.g. owlit://docs/drafts/Related work.md), a chat (owlit://chat/<id>), a Settings section (owlit://settings/<section>) or the shortcut list (owlit://shortcuts). Use it when the user asks to see something, not on your own.",
    inputSchema: { type: "object", properties: { uri: { type: "string", description: "An owlit:// link" } }, required: ["uri"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_jump",
    touches: "read",
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
    touches: "own",
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
    name: "thread_list",
    touches: "read",
    description:
      "The threads Owlit keeps for the user: papers gathered for a question, with what each says about it. Each line: id, title, the project it belongs to, how many papers and columns, and the question as the user asked it. Look here before you start one: when the user asks something close to a thread's question, add to that thread rather than starting another.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "thread_read",
    touches: "read",
    description:
      "One thread as the user sees it: its question, columns, groupings with their groups, memo (sentences with their ids) and every paper with its answers, each marked abstract or full text, and the groups it is in. Also what the user rewrote (keep it), removed (never bring it back) and changed in the groups (keep it so).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The thread's id" } }, required: ["id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "thread_write",
    touches: "own",
    description:
      "Gather papers you found into a thread, new (no id) or existing, instead of adding them to the library: the user sees it under Threads and decides what to keep. A paper is named by the id library_search, library_related or library_journal gave; owlit fills in what it is. Each row's answer says in one plain sentence what that paper found about the question, from its whole abstract (library_get gives it; a search's line cuts it short) (depth abstract) or from its full text (depth full, with the words it rests on in quote, word for word as library_read gives them; only papers in the library have full text). The memo is at most four sentences on what the papers say together: agreements, disagreements, what none of them covers. It describes the papers, not your search (that goes in note); it doesn't tell the user what to write or conclude. Name papers in it as [Author Year](owlit://library/<id>). The user's rewrites stay and their removals stay out whatever you write. Says the thread's link.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "An existing thread's id; leave out to start one" },
        asked: { type: "string", description: "The user's question in their own words: needed to start one, and given too when you add to one for a new question" },
        title: { type: "string", description: "A short neutral title for what it gathers, in the user's language, naming the topic rather than repeating the question: 回放式标注作为研究方法, not 我的研究方法该怎么设计？ (needed to start one)" },
        project: { type: "string", description: "The workspace's top-level folder the work belongs to, when it plainly belongs to one (optional)" },
        note: {
          type: "string",
          description:
            "One plain sentence on what this search couldn't reach, shown with it under the thread's About: a source that failed, an index that misses part of a venue, papers with no abstract. Leave out when nothing was missed; owlit records your searches itself. (optional)",
        },
        rows: {
          type: "string",
          description:
            'JSON array of papers to add or update: [{"id": "doi-10.1145-…", "answer": "Replay ratings were 0.6 points lower than live ones.", "depth": "abstract"}, {"id": "arxiv-2408.00447", "answer": "…", "depth": "full", "quote": "words from the text", "group": "eval"}]. Answers for other columns go in "cells": {"<column id>": {"text": "…", "depth": "abstract"}}. A paper usually goes in one group; give it a second, as "groups": ["eval", "data"] instead of group, only when it is really used in both.',
        },
        memo: {
          type: "string",
          description: 'JSON array of the whole memo as it should be now, at most four sentences: [{"id": "s1", "text": "…"}, {"text": "a new sentence"}]. Keep a sentence\'s id when you keep or reword it. (optional)',
        },
        groups: {
          type: "string",
          description:
            'JSON array of the whole grouping, for many papers: [{"id": "eval", "name": "Evaluating proactive systems", "one": "replay, in-situ and benchmark ground truth", "parent": "…"}]. It replaces the thread\'s own grouping (Topic), or the one named in grouping; to group the papers another way, give new_grouping instead and keep the others. Two levels at most: a group with a parent can\'t be a parent itself. Groups the user merged or ungrouped stay so, and papers the user put in a group stay there; thread_read says which. (optional)',
        },
        grouping: { type: "string", description: "Which grouping groups and the rows' group are for, by its column id as thread_read gives it; leave out for the thread's own (Topic) (optional)" },
        new_grouping: {
          type: "string",
          description: "A new way of grouping this thread's papers, in the user's words (\"by method\", \"按研究故事的章节\"): groups and the rows' group in this write are for it. When the user asks to see the papers another way, use this rather than starting a new thread. (optional)",
        },
        columns: { type: "array", items: { type: "string" }, description: "New questions to ask of every paper, each becoming a column (optional)" },
        remove_rows: { type: "array", items: { type: "string" }, description: "Ids of papers you take out again (optional)" },
        why: { type: "string", description: "One plain sentence on what this write did, for the thread's history (optional)" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "thread_edit",
    touches: "meta",
    description: "Rename a thread when the user asks. A title the user gave the thread themselves stays. Deleting, splitting and merging threads are the user's, in owlit.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The thread's id" },
        title: { type: "string", description: "Its new title, in the user's language" },
      },
      required: ["id", "title"],
    },
  },
  {
    name: "owlit_help",
    touches: "read",
    description:
      "How to use owlit, for when the user asks about owlit itself (adding papers, getting PDFs, highlighting, citing, docs, threads, undoing Owlit's changes, settings, shortcuts). Without a topic, lists the topics; with one, gives it, with how to link the user to a Settings section.",
    inputSchema: { type: "object", properties: { topic: { type: "string", description: "A topic from the list, or a word to look for (optional)" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "activity_read",
    touches: "read",
    description:
      "What the user did in owlit lately, as facts: which papers they spent time in (how long, which pages, how often they came back, highlights, notes, stars and status, and how far they got: read in full, looked at, or not opened here), which docs they opened and edited, which chats they wrote in, and what agents changed. mode=recent: what they touched lately, newest first. mode=top: what they spent the most on. mode=of: the history of one paper (with the sentences Owlit's answers cited from it), doc or chat. mode=log: what happened in order, one line per visit to a paper. Says so when the user has turned recording off.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["recent", "top", "of", "log"], description: "Which question to ask" },
        since: { type: "string", description: "From when: '24h', '7d', '2w' back from now, or a date like 2026-10-07 (default 14 days for recent, 7 for top and log)" },
        until: { type: "string", description: "log only: up to when, the same way" },
        paper: { type: "string", description: "of: the paper's library id" },
        doc: { type: "string", description: "of: the doc's path in the workspace" },
        chat: { type: "string", description: "of: the chat's id" },
        // Words for the agent asking, not actor ids: core reads user as the person's id and agent as an
        // Owlit's (activity/query.ts)
        actor: { type: "string", enum: ["user", "agent"], description: "log only: only what the user did, or only what agents did" },
        limit: { type: "number", description: "At most this many items or lines (default 10, log 100, never more than 200)" },
      },
      required: ["mode"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "memory_write",
    touches: "own",
    description:
      "Change what Owlit keeps in mind about the user: owlit's memory, one short list for this workspace that every session hears at its start. Keep a line when the user tells you to remember something or says \"from now on\", \"always\" or \"never\"; when they correct how you work in plain words; or when they state a fact about their work that will matter in a later chat. Not for guesses from habits, one-off requests, what papers say or what the user did. The user sees each change in the chat and can undo it.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["add", "replace", "remove"], description: "add a line; replace one (its id) when the user changed their mind or a line needs merging; remove one they take back" },
        kind: { type: "string", enum: ["work", "about"], description: "add, or to move a line on replace: work = how the user wants Owlit to work; about = a fact about their work" },
        text: { type: "string", description: "add and replace: one short sentence, in the user's words and language" },
        id: { type: "string", description: "replace and remove: the line's id (m1, m2…), as the memory note lists it" },
      },
      required: ["op"],
    },
  },
  {
    name: "chats_list",
    touches: "read",
    description: "The user's chats with owlit, most recent first: id, title, when.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chats_read",
    touches: "read",
    description: "One chat's messages as text.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The chat's id" } }, required: ["id"] },
  },
  ]
}
