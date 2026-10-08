# Library — design proposal (draft 3, 2026-10-08)

Status: for discussion. Draft 2 is implemented on `claude/library-page-design-*` and was judged
neither good-looking nor easy to use; the main complaint is that the information is scattered and the
structure is unclear. Draft 3 restructures the page rather than restyling it.

Clickable mockup: `docs/mockups/library.html` (served by the dev server at `/_mockups/library.html`;
`#paper=p10`, `#peek=p14`, `#dark` deep-link into states).

Still decided: PDF viewer is EmbedPDF; tags only, collections go to Knowledge as Topics later; owlit is
a local desktop app; the Library is a page and a paper is a page (no list panel).

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

## Structure: three levels, one job each

| Level | The question it answers | Where | What it shows |
|---|---|---|---|
| Library page | What's on my desk? What do I pick up next? | `/library` | Continue reading, then every paper by when it arrived |
| Peek | Is this worth reading? | The row, opened in place | Full title, authors, venue, abstract, tags, status, Read button |
| Paper page | Read it, and keep what I take from it | `/library/:id` | The PDF, with Notes, Highlights and About beside it |

Each level adds detail to the one before; nothing on a level repeats in another form. Moving
between them is always the same gesture: click goes one level deeper, Esc or Back one level up.

### Where each piece of information lives

| Information | Row | Peek | Paper page |
|---|---|---|---|
| Title | one line, truncated last | full | big serif title in the panel; breadcrumb |
| Authors, year | short ("Kang et al. · 2023") | full list, venue | full list, venue |
| Star | small mark after the year; toggle on hover | toggle | toggle |
| Status | reading: progress ring; read: quieter title; unread: nothing | one text menu | same text menu, with the page you're on |
| Abstract | — | yes | About |
| Tags | — | chips; click one to filter | About |
| Ids, links, added, file | — | — | About |
| Highlights, note | — | — | their own tabs |

Status has one control, a plain text menu ("Reading ▾"), in exactly two places. In the list it is
not a control at all; it shows only through position and tone.

## Library page

Top to bottom, in one centred column as wide as the Chat thread (768px):

1. **Title** "Library" in the display serif, the same moment as Chat's greeting.
2. **One field for find and add**, raised like the composer (card surface, soft shadow, 14px
   radius). Typing filters the list live. Pasting a DOI, arXiv id or link turns the results into a
   single card: "Looking up…", then the resolved paper with Add (↵), or "Already in your library"
   with Open. Typing `#tag` turns into a removable filter token inside the field; Backspace on an
   empty field removes the last token. A paperclip adds a PDF file; dropping a PDF anywhere on the
   page still works. `/` focuses the field, Esc clears it.
3. **Views** as rounded chips: All · Reading · Starred · Unread · Read, counts in a lighter tone
   (none on All). On the same line, right-aligned, a quiet sort menu: Recently added · Year
   published · Title. Sort direction is implied by the key; there is no ascending/descending item.
4. **Continue reading** (All view, no search): up to three cards for papers in progress, each with
   title, short authors and a thin progress line with "p. 6 of 19". Click resumes at that page.
5. **The list**, grouped like Chat's history: Today · Previous 7 days · Previous 30 days · Earlier
   (by year when sorted by year, ungrouped by title, a single "N papers" label while searching).

**Row**: 36px, one line: title, then short authors · year in muted text, then a small star if
starred. Right edge is empty at rest except a progress ring for papers being read. Read papers
have a quieter title, so finished work recedes. Hover shows a star toggle and a vertical ellipsis.
No tags, no dates, no status glyphs.

**Peek**: click a row and it opens in place into a raised card: full title, all authors, venue
and year, the abstract, then one footer line with tags (click to filter, + Tag), status menu,
star, ellipsis and the primary button: Read, or "Continue p. 6" when in progress. Click the card
again or press Esc to fold it. Only one peek is open at a time.

**Select several**: ⌘-click or ⇧-click selects without peeking. With two or more selected, a
floating bar appears at the bottom of the sheet: "3 selected · Star · Mark as · Add tag ·
Remove · ×". This replaces the bulk side pane.

**Row menu** (ellipsis or right-click), words only: Open · Copy citation · Copy BibTeX ·
Mention in Chat · Edit details · Remove from library.

## Paper page

- **Header** (inside the sheet, no rule under it): breadcrumb "Library › title", then "7 of 16"
  with previous / next in the current list, and a side-panel toggle. The breadcrumb is how you
  know where you are; the shell's back arrow does the same as clicking "Library", and returns to
  the list with filters, scroll and peek intact.
- **Reader**: the PDF on a slightly darker well, pages as the brightest surface. One floating
  dock at the bottom: page ‹ 6 / 19 ›, zoom − 110% +, find. Selecting text shows a small popover:
  four colours · Comment · Copy · Ask (Ask sends the passage to Chat, later).
- **Side panel** (380px, same tone as the sheet, toggleable): the title in the display serif,
  authors and venue, one control line (status menu with page, star, ellipsis), then three chips:
  **Notes** (one note per paper, the default when you have one), **Highlights** (grouped by page,
  colour bar, quote, comment; click to jump), **About** (abstract, tags, DOI / arXiv, added and
  by whom, file).
- **No PDF**: the well shows a dashed drop area with "No PDF yet", Find PDF and Choose file; the
  panel opens on About.

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
   edit details. To redo for draft 3: library page (find-and-add field, views, Continue reading,
   grouped rows, peek, floating bulk bar), paper page shell (breadcrumb header, side panel with
   Notes / Highlights / About, no-PDF state). The detail pane goes away.
2. EmbedPDF reader port, selection popover, highlights persisted and listed, jump to highlight,
   note tab, remembered reading position, ⌘K jump, copy citation / BibTeX.
3. Later, still frontend: Inbox for agent-added papers, Ask / Quote actions into Chat and Docs,
   several papers open as tabs, Topics in Knowledge.

Out of scope until the desktop shell exists: SQLite / files, real metadata resolution, PDF
fetching, full-text search, agent access to the library.

## Open questions for this round

1. **Click to peek, Enter to open.** The peek makes the list the place to triage, so opening
   becomes deliberate (Read button, Enter, double-click). The alternative is click = open the paper
   page, with no peek at all; simpler, but triage then costs a page load per paper.
2. **Tags off the rows.** They move to the peek and the About tab, and are used as filters in the
   field. If you scan by tag a lot, a muted `#tag` after the year is the fallback.
3. **Read papers quieter.** Finished papers get a lighter title; unread ones have no mark at all.
   The opposite convention, a dot on unread like mail, is louder but more familiar.
4. **Continue reading cards.** Three at most, only on All. Worth the space, or just let the
   Reading chip do it?

## Decisions log

- 2026-10-08: layout is page-based (table page + paper page); status model unread → reading →
  read with star for priority; tags only, Topics live in Knowledge; no other Zotero features
  for now; storage design deferred.
- 2026-10-08: draft 2 rejected as unclear. Draft 3 proposes three levels (page, peek, paper),
  one home per piece of information, one find-and-add field, and words-only menus (letter
  shortcuts removed from the paper menu).
