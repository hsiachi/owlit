# Library — design proposal (draft 2, 2026-10-08)

Status: for discussion. Not yet implemented. Decided so far: PDF viewer is EmbedPDF (headless,
ported from the archived v4 viewer); tags only, collections go to Knowledge as Topics later;
owlit is a local desktop app, so data and storage are designed fresh.

## What the Library is for

The jobs, in the order they happen in real use:

1. **Capture** — get a paper in with near-zero friction: paste a DOI / arXiv id / URL, drop a
   PDF, or accept one the agent found. Metadata resolves itself; the PDF is fetched when it can be.
2. **Triage** — decide what to read: skim the abstract, star what matters, let the rest sit.
3. **Read** — the PDF, with highlights and a note. This is the core and gets the most space.
4. **Find again** — search by title / author / tag, filter by status, sort; later full text.
5. **Reuse** — the paper and its highlights are objects the rest of owlit can point at:
   @-mention in Chat, quote into Docs, cluster into Knowledge Topics.

Everything below is derived from these five.

## Data model

Three kinds of records. Facts about the paper, the user's judgement about it, and marks made on it.

```ts
interface Paper {
  id: string                       // owlit's own id; external ids are fields
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  ids: { doi?: string; arxiv?: string; url?: string }
  pdf?: { path: string; pages?: number }   // one PDF for v1; attachments later
  addedAt: number
  addedBy: "user" | "agent"        // reserved; "agent + unread" is the Inbox view
  // user's judgement
  starred: boolean
  status: "unread" | "reading" | "read"
  tags: string[]
  // reading position, so "Continue reading" works and a paper reopens where you left it
  lastOpenedAt?: number
  lastPage?: number
}

interface Highlight {
  id: string
  paperId: string
  page: number                     // 0-based
  rects: Rect[]                    // page space, from EmbedPDF's selection
  text: string
  color: "yellow" | "green" | "blue" | "pink"
  comment?: string
  createdAt: number
}

interface PaperNote {              // one markdown note per paper; also visible from Docs later
  paperId: string
  content: string
  updatedAt: number
}
```

Status is deliberately three values. `unread` is the default on add, `reading` is set
automatically the first time the PDF is opened, `read` is set only by the user. Priority is
the star, not another status. "Skipped / not relevant" is removal.

## State (frontend only for now)

Records live in a zustand store with `persist` (localStorage), the same arrangement as Chat,
seeded with mock papers. A small `LibraryClient` interface covers only what the desktop shell
will eventually do for the UI: resolve a reference to metadata, read metadata from a dropped
PDF, serve a PDF. v1 has a mock implementation.

## Layout (decided 2026-10-08: Library is a page, a paper is a page)

Shell as it is: icon rail, main area. Library has **no** list panel; the library list is the
main area itself, and a paper opens as its own page. Chat keeps its panel because its list is
short titles; a library needs a table.

**Library page** (`/library`)
- Page header in the Chat/Claude idiom: big title + Add paper; below it filter chips
  All · Starred · Unread · Reading · Read with counts (Inbox appears once agent adds exist),
  then search (`/` focuses it), tag multi-select and a sort menu (key + direction).
- A quiet list rather than a spreadsheet: one line per paper, title followed inline by
  "authors · year · venue" in muted text (the ⌘K-palette row pattern), then tag chips, a
  status glyph (click to change), date added, ⋯. No header row; sorting lives in the sort
  menu. Secondary columns drop out as the column narrows. Multi-select with shift / ⌘-click
  for bulk tag, status and remove.
- Single click selects and opens a right **detail pane**: abstract, metadata, external links,
  tags editor, status, edit details. Enough for triage without starting the PDF engine.
- Enter or double-click opens the paper page. Row menu (⋯ / right-click): open, star, set
  status, edit tags, copy citation, remove (undo toast).
- Keys: ↑↓ move, Enter open, S star, ⌘K jump to any paper.
- Empty library: Add-a-paper call to action with the drop zone.

**Paper page** (`/library/:id`) — reader first
- Compact one-line header: title, star, status, previous / next within the current filtered
  list, ⋯ menu (edit details, copy BibTeX, remove). Shell's back button returns to the table
  with its filters and scroll position intact.
- Body is the PDF, full width; floating chips for zoom / find / page / back after following a
  link (ported from v4).
- Toggleable right panel with three tabs: **Info** (authors, venue, year, abstract, links,
  tags editor), **Highlights** (grouped by page, colour swatch, text, comment; click scrolls
  to it), **Note** (one markdown note, tiptap).
- No PDF: Info fills the body with a drop zone / "Fetch PDF" action in place of the reader.
- Select text → popover: four colours, Copy, Comment; later Ask (send to Chat) and Quote (into
  a Doc). Click a highlight → recolour, comment, delete.
- Later: several papers open as tabs.

Why this over a left list panel: triage needs a table (columns, sorting, multi-select) and
reading needs width; a 350px panel serves neither, and gets collapsed while reading anyway.
Switching papers is covered by previous / next and ⌘K.

**Capture**
- Add button → popover: one field that accepts a DOI, arXiv id/URL, or any URL; plus a PDF
  drop target. Dropping a PDF anywhere on the Library page also adds it.
- v1 resolves against mock data; PDF-only adds take the title from the filename, editable.
- Remove = undo toast, then gone (files too). No trash in v1.

## Phases (frontend only; real storage and the desktop shell are out of scope for now)

1. Feature scaffold, mock data and store, library page: table with search / filters / sort /
   multi-select, detail pane, add / remove / star / status / tags, edit details; paper page
   shell with header, Info panel, previous / next and the no-PDF state.
2. EmbedPDF reader port, selection popover, highlights persisted and listed, jump to highlight,
   note tab, remembered reading position, ⌘K jump, copy citation / BibTeX.
3. Later, still frontend: Inbox for agent-added papers, Ask / Quote actions into Chat and Docs,
   several papers open as tabs, Topics in Knowledge.

Out of scope until the desktop shell exists: SQLite / files, real metadata resolution, PDF
fetching, full-text search, agent access to the library.

## Decisions log

- 2026-10-08: layout is page-based (table page + paper page); status model unread → reading →
  read with star for priority; tags only, Topics live in Knowledge; no other Zotero features
  for now; storage design deferred.
