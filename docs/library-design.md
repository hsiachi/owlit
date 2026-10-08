# Library — design proposal (draft 3, 2026-10-08)

Status: for discussion. Draft 2 is implemented on `claude/library-page-design-*` and was judged
neither good-looking nor easy to use; the main complaint is that the information is scattered and the
structure is unclear. Draft 3 restructures the page rather than restyling it.

Clickable mockup: `docs/mockups/library.html` (served by the dev server at `/_mockups/library.html`;
`#paper=p10`, `#peek=p14`, `#dark` deep-link into states).

Still decided: PDF viewer is EmbedPDF; tags only, collections go to Knowledge as Topics later; owlit is
a local desktop app; a paper is a page. Round 3: two pages (Up next, Library) switched by the title; no
list panel for now.

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

## What went wrong in draft 2

- **One fact, three looks.** Status is a circle glyph in the row, an "Unread" button in the side pane
  and a select on the paper page. Tags, authors and abstract are repeated between the side pane and
  the paper page's Info tab.
- **Two surfaces for one paper.** The side pane and the paper page overlap. Click selects and opens
  the pane, double-click opens the page; nothing says when to use which.
- **No hierarchy in a row.** Star, title, citation, tags, status, date and ⋯ all sit at the same
  weight. Sixteen identical rows read as a wall, and the title, the one thing you scan for, is
  truncated first.
- **Triage information last.** The side pane leads with your own tags and ends with the abstract,
  which is what you actually read to decide.
- **Four ways to narrow, all at once.** Status chips, search, a tag popover and a sort menu share one
  line with the page title's weight.

## Structure: two pages, then three levels

The Library has two pages, switched by its title: **Up next** and **Library**. The title is two
words side by side, the current one in full colour and the other one lighter, so switching costs
no extra chrome. A third word (Feed) can join later; whether feeds live here is still open. There
is no list panel: with filters and tags inside the Library page it would hold two rows. A panel
becomes worth it once there is a growing list to put in it, such as search runs or feeds.

- **Up next** answers "what should I read next?". owlit and agents decide what is on it, and it
  changes as the reader's state changes. Rows are grouped by why they are there: Continue
  reading · Because you're reading *Synergi* · From your search *“…”* · Found by Claude Code ·
  Shares #agents with *ReAct*. The group label is the reason, so rows stay one line. It can hold
  papers that are **not in the library** yet: those carry an Add button, and their peek says "Not
  in your library" with Add to library as the primary action. Every row can be dismissed (×, "Not
  interested"), which is the feedback the reordering learns from. One muted line on top says what
  the order is based on and when it was refreshed. Default page.
- **Library** answers "what do I have?". The user is in control of it: find-and-add field, filter
  chips All · Reading · Starred · Unread · Read with counts, a Tags menu on the right of the same
  line (colour dot, name, count; selected tags show as removable chips), sort menu and List /
  Table toggle in the header.

Within either page there are three levels, each with one job:

| Level | The question it answers | Where | What it shows |
|---|---|---|---|
| Page | What's here, in what order? | `/library`, `/library/all` | Rows (List or Table on Library) |
| Peek | Is this worth reading? | The row, opened in place | Full title, authors, venue, abstract, tags, status, Read / Add |
| Paper page | Read it, and keep what I take from it | `/library/:id` | The PDF, with Notes, Highlights and About beside it |

Click goes one level deeper; Esc or Back goes one level up. The paper page's breadcrumb starts
with the page you came from ("Up next ›" or "Library ›").

### Where each piece of information lives

| Information | Row (List) | Row (Table) | Peek | Paper page |
|---|---|---|---|---|
| Title | one line, truncated last | Title column | full | panel title; breadcrumb |
| Authors, year | short, muted | Authors, Year columns | full list, venue | full list, venue |
| Venue | — | Venue column | yes | yes |
| Why it's suggested | the group label (Up next) | — | — | — |
| Star | amber mark; toggle on hover | amber mark; toggle on hover | toggle | toggle |
| Status | read titles are quieter; nothing else | Status column (blank = unread) | text menu | text menu |
| Tags | — | first tag + count | chips, click to open the tag | About |
| Added | group labels | Added column | — | About |
| Abstract, ids, file | — | — | abstract | About |

No reading progress anywhere in the list: no rings, bars or "p. 6 of 19". A paper simply reopens
where you left it, and the page number lives only in the reader's dock.

## The Library page

One column, 768px for List and up to 1120px for Table:

1. **Header line**: the Up next / Library switch (Figtree, 22px, medium), and on the right a quiet
   sort menu (Recently added · Year · Title; not in Table, where the column headers sort) and a
   List / Table toggle.
2. **Filter line**: chips All · Reading · Starred · Unread · Read with counts; Tags menu at the end.
3. **One field for find and add**, raised like the composer. Typing filters the view live.
   Pasting a DOI, arXiv id or link turns the results into a single card: "Looking up…", then the
   resolved paper with Add (↵), or "Already in your library" with Open. A paperclip adds a PDF
   file; dropping a PDF anywhere still works. `/` focuses, Esc clears.
4. **List layout**: rows grouped like Chat's history (Today · Previous 7 days · Previous 30 days
   · Earlier; by year when sorted by year; one "N papers" label while searching).
5. **Table layout**: header text only, one hairline under it, no grid. Columns Title · Authors ·
   Year · Venue · Tags · Status · Added; click a header to sort. Hovering a row swaps the date
   for star and ellipsis. Clicking a row peeks, in a full-width row under it.

**Row (List)**: 36px, one line: title, short authors · year in muted text, an amber star if
starred. Read papers have a quieter title. Hover shows star and ellipsis.

**Peek**: the row opens in place into a raised card: full title, all authors, venue and year,
the abstract, the reason in Up next, then tags (click to open that tag), status menu, star,
ellipsis and the primary button (Read, Continue, or Open when there's no PDF).

**Select several**: ⌘-click or ⇧-click. With two or more selected, a floating bar appears at the
bottom of the sheet: "3 selected · Star · Mark as · Add tag · Remove · ×".

**Row menu** (ellipsis or right-click), words only: Open · Copy citation · Copy BibTeX · Mention
in Chat · Edit details · Remove from library.

## Paper page

- **Header** (inside the sheet, no rule under it): breadcrumb "<view> › title", then "7 of 16"
  with previous / next within that view, and a toggle for the details panel.
- **Reader**: the PDF on a slightly darker well, pages as the brightest surface. One floating
  dock: page ‹ 6 / 19 ›, zoom − 110% +, find. Selecting text shows a popover: four colours ·
  Comment · Copy · Ask (Ask sends the passage to Chat, later).
- **Details panel** (380px, toggleable): title in Figtree 18px medium, authors and venue, one
  control line (status menu, star, ellipsis), then three chips: **Notes** (default when you have
  one), **Highlights** (by page, colour bar, quote, comment; click to jump), **About** (abstract,
  tags, DOI / arXiv, added and by whom, file).
- **No PDF**: the well shows a dashed drop area with "No PDF yet", Find PDF and Choose file; the
  panel opens on About.

## Type and colour

- **One typeface.** Figtree everywhere in the Library, titles included. The display serif stays a
  Chat greeting moment; a long title in it was tiring to read.
- **Colour carries meaning, never decoration.** Three uses, all semantic tokens:
  - Tags: eight low-chroma hues (`--tag-red` … `--tag-pink`), shown as a small dot beside the
    name in the panel, the table, peek and About. The user picks the colour; new tags get one in
    turn.
  - Star: `--star`, a warm amber, for the filled mark and the active toggle.
  - Highlights: four colours inside the PDF and as the bar beside each quote.
- The rest stays neutral. Primary buttons remain near-black; no brand accent.

## Keyboard

`/` find · ↑↓ move · Space or click peek · Enter open · S star · Esc fold, clear, or go up a level ·
⌘K jump to any paper (later).

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

## Phases (frontend only; real storage and the desktop shell are out of scope for now)

1. Done in draft 2: feature scaffold, mock data and store, add / remove / star / status / tags,
   edit details. To redo for draft 3: places panel, views (find-and-add field, List and Table
   layouts, grouped rows, Up next with reasons, peek, floating bulk bar), paper page shell (breadcrumb header, side panel with
   Notes / Highlights / About, no-PDF state). The detail pane goes away.
2. EmbedPDF reader port, selection popover, highlights persisted and listed, jump to highlight,
   note tab, remembered reading position, ⌘K jump, copy citation / BibTeX.
3. Later, still frontend: Inbox for agent-added papers, Ask / Quote actions into Chat and Docs,
   several papers open as tabs, Topics in Knowledge.

Out of scope until the desktop shell exists: SQLite / files, real metadata resolution, PDF
fetching, full-text search, agent access to the library.

## Open questions for this round

1. **Default page**: Up next (recommended) or Library?
2. **Papers not in the library on Up next**: is the Add button enough to tell them apart?
3. **How smart is Up next?** The mock groups by signals owlit can compute locally (citations,
   shared tags, agent finds, search runs). Re-ranking by the reader's knowledge state needs
   Knowledge to exist first.
4. **Feed**: a third page here, or somewhere else? Deferred.

## Decisions log

- 2026-10-08: layout is page-based (table page + paper page); status model unread → reading →
  read with star for priority; tags only, Topics live in Knowledge; no other Zotero features
  for now; storage design deferred.
- 2026-10-08: draft 2 rejected as unclear. Draft 3 proposes three levels (page, peek, paper),
  one home per piece of information, one find-and-add field, and words-only menus (letter
  shortcuts removed from the paper menu).
- 2026-10-08 (round 2): accepted three levels, peek, find-and-add. Asked for less showy type
  and no reading progress. Proposed: places panel (Up next, Inbox, Reading, Starred, All papers,
  Tags), List / Table layouts, colour only for tags, star and highlights.
- 2026-10-08 (round 3): hsiachi proposed splitting into Up next (smart, dynamic, may include
  papers found by search) and Library (the whole collection, filters inside). Mocked as two pages
  switched by the title; the places panel from round 2 is dropped.
