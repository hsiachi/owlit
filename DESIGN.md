---
version: alpha
name: owlit
description: A quiet, paper-toned desk for reading, writing and thinking through papers with Owlit. One sheet, a few places, an assistant that marks its work in one colour and otherwise steps back.
colors:
  # Light mode, warm tone. Dark values and the other tones are in app/src/index.css, the source of truth.
  # Surfaces, back to front
  sidebar: "oklch(0.942 0.007 80)"
  sidebar-panel: "oklch(0.976 0.004 85)"
  background: "oklch(0.99 0.002 85)"
  card: "oklch(1 0 0)"
  popover: "oklch(1 0 0)"
  # Text
  foreground: "oklch(0.21 0.008 60)"
  muted-foreground: "oklch(0.505 0.012 65)"
  primary: "oklch(0.25 0.008 60)"
  primary-foreground: "oklch(0.985 0.003 85)"
  # State fills: translucent tints of the text colour
  muted: "oklch(0.3 0.02 65 / 5%)"
  secondary: "oklch(0.3 0.02 65 / 5%)"
  accent: "oklch(0.3 0.02 65 / 6%)"
  sidebar-accent: "oklch(0.3 0.02 65 / 6.5%)"
  # Lines
  border: "oklch(0.905 0.006 80)"
  input: "oklch(0.9 0.006 80)"
  ring: "oklch(0.7 0.012 70)"
  # Marks: one meaning each, unchanged by paper tone
  mention: "oklch(0.48 0.09 255)"
  warning: "oklch(0.66 0.12 70)"
  destructive: "oklch(0.55 0.16 25)"
  success: "oklch(0.56 0.1 155)"
  suggestion: "oklch(0.5 0.11 155)"
  note: "oklch(0.76 0.15 75)"
  note-rim: "oklch(0.62 0.13 70)"
  text-highlight: "oklch(0.93 0.11 98)"
  star: "oklch(0.64 0.13 72)"
  tag-red: "oklch(0.64 0.11 28)"
  tag-orange: "oklch(0.7 0.11 55)"
  tag-amber: "oklch(0.76 0.11 85)"
  tag-green: "oklch(0.66 0.09 145)"
  tag-teal: "oklch(0.66 0.07 195)"
  tag-blue: "oklch(0.62 0.09 250)"
  tag-violet: "oklch(0.6 0.1 295)"
  tag-pink: "oklch(0.68 0.1 350)"
  # PDF marks: a rendered page is white in both themes, so these never flip
  highlight-yellow: "oklch(0.93 0.11 98)"
  highlight-green: "oklch(0.91 0.08 150)"
  highlight-blue: "oklch(0.9 0.055 240)"
  highlight-pink: "oklch(0.9 0.065 355)"
  highlight-yellow-mark: "oklch(0.82 0.15 92)"
  highlight-green-mark: "oklch(0.72 0.13 150)"
  highlight-blue-mark: "oklch(0.68 0.1 245)"
  highlight-pink-mark: "oklch(0.7 0.13 355)"
  pdf-selection: "oklch(0.86 0.06 255)"
  pdf-search: "oklch(0.87 0.012 75)"
  pdf-search-active: "oklch(0.8 0.13 60)"
  pdf-link: "oklch(0.48 0.09 255)"
  pdf-page-edge: "oklch(0 0 0 / 9%)"
  pdf-ink: "oklch(0.3 0.02 65 / 70%)"
typography:
  display:
    fontFamily: Dosis
    fontSize: 44px
    fontWeight: 500
    lineHeight: 1
  title:
    fontFamily: Figtree
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.015em
  heading:
    fontFamily: Figtree
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.375
  doc-title:
    fontFamily: Figtree
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.015em
  doc-heading:
    fontFamily: Figtree
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  doc-subheading:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
  section-title:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.625
  doc-body:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.7
  ui:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
  ui-strong:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.43
  secondary:
    fontFamily: Figtree
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: Figtree
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  code:
    fontFamily: ui-monospace
    fontSize: 0.85em
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  2xl: 18px
  full: 9999px
spacing:
  frame-gap: 4px
  top-bar: 40px
  rail: 40px
  rail-button: 32px
  list-panel: 260px
  agent-panel: 400px
  page-header: 44px
  list-row: 36px
  tree-row: 32px
  menu-row: 32px
  gutter: 16px
  column: 768px
  wide-column: 1152px
components:
  frame:
    backgroundColor: "{colors.sidebar}"
    height: "{spacing.top-bar}"
  rail-button:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    height: "{spacing.rail-button}"
  rail-button-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
  needs-you-dot:
    backgroundColor: "{colors.warning}"
  main-sheet:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
  list-panel:
    backgroundColor: "{colors.sidebar-panel}"
  agent-panel:
    backgroundColor: "{colors.sidebar-panel}"
  reader-well:
    backgroundColor: "{colors.sidebar-panel}"
  page-header:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    height: "{spacing.page-header}"
  page-title:
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
  group-label:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
  list-row:
    textColor: "{colors.foreground}"
    typography: "{typography.ui}"
    height: "{spacing.list-row}"
    rounded: "{rounded.md}"
  list-row-hover:
    backgroundColor: "{colors.muted}"
  list-row-selected:
    backgroundColor: "{colors.accent}"
  panel-row-hover:
    backgroundColor: "{colors.sidebar-accent}"
  tree-row:
    typography: "{typography.ui}"
    height: "{spacing.tree-row}"
    rounded: "{rounded.md}"
  status-ring:
    textColor: "{colors.muted-foreground}"
  note-dot:
    backgroundColor: "{colors.note}"
  star-mark:
    textColor: "{colors.star}"
  menu:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  menu-row:
    textColor: "{colors.foreground}"
    typography: "{typography.ui}"
    height: "{spacing.menu-row}"
    rounded: "{rounded.md}"
  menu-row-highlight:
    backgroundColor: "{colors.accent}"
  menu-row-destructive:
    textColor: "{colors.destructive}"
  tooltip:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
  kbd:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  dialog:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  toast:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.lg}"
  command-palette:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  floating-pill:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  bordered-list:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  peek:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  composer:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  composer-picker:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    rounded: "{rounded.md}"
  ask-bar:
    backgroundColor: "{colors.card}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  find-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  text-field:
    textColor: "{colors.foreground}"
    typography: "{typography.ui}"
    rounded: "{rounded.lg}"
  focus-ring:
    textColor: "{colors.ring}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.lg}"
  button-ghost:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.lg}"
  segmented-control:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.lg}"
  segmented-control-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
  tab-underline:
    textColor: "{colors.foreground}"
  filter-chip:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    rounded: "{rounded.full}"
  filter-chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  status-chip:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
  starter-chip:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    rounded: "{rounded.full}"
  tag-chip:
    backgroundColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
  context-chip:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
  attachment-chip:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  mention:
    textColor: "{colors.mention}"
  user-bubble:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  steps-block:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
  step-failed:
    textColor: "{colors.destructive}"
  result-card:
    rounded: "{rounded.lg}"
  broken-block:
    textColor: "{colors.destructive}"
    typography: "{typography.secondary}"
    rounded: "{rounded.lg}"
  waiting-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  waiting-shield:
    textColor: "{colors.warning}"
  check-mark:
    textColor: "{colors.success}"
  code-block:
    backgroundColor: "{colors.muted}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
  owlit-edit-added:
    textColor: "{colors.suggestion}"
  owlit-edit-removed:
    textColor: "{colors.muted-foreground}"
  owlit-note-underline:
    textColor: "{colors.note-rim}"
  owlit-note-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  doc-highlight:
    backgroundColor: "{colors.text-highlight}"
  selection-menu:
    backgroundColor: "{colors.popover}"
    typography: "{typography.secondary}"
    rounded: "{rounded.md}"
  empty-box:
    rounded: "{rounded.2xl}"
  tag-dot-red:
    backgroundColor: "{colors.tag-red}"
  tag-dot-orange:
    backgroundColor: "{colors.tag-orange}"
  tag-dot-amber:
    backgroundColor: "{colors.tag-amber}"
  tag-dot-green:
    backgroundColor: "{colors.tag-green}"
  tag-dot-teal:
    backgroundColor: "{colors.tag-teal}"
  tag-dot-blue:
    backgroundColor: "{colors.tag-blue}"
  tag-dot-violet:
    backgroundColor: "{colors.tag-violet}"
  tag-dot-pink:
    backgroundColor: "{colors.tag-pink}"
  highlight-popover:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  highlight-check:
    textColor: "{colors.pdf-ink}"
  pdf-page:
    backgroundColor: "#ffffff"
    textColor: "{colors.pdf-page-edge}"
  pdf-selection:
    backgroundColor: "{colors.pdf-selection}"
  pdf-find-match:
    backgroundColor: "{colors.pdf-search}"
  pdf-find-match-active:
    backgroundColor: "{colors.pdf-search-active}"
  passage-ring:
    textColor: "{colors.pdf-link}"
  highlight-yellow:
    backgroundColor: "{colors.highlight-yellow}"
  highlight-green:
    backgroundColor: "{colors.highlight-green}"
  highlight-blue:
    backgroundColor: "{colors.highlight-blue}"
  highlight-pink:
    backgroundColor: "{colors.highlight-pink}"
  highlight-bar-yellow:
    backgroundColor: "{colors.highlight-yellow-mark}"
  highlight-bar-green:
    backgroundColor: "{colors.highlight-green-mark}"
  highlight-bar-blue:
    backgroundColor: "{colors.highlight-blue-mark}"
  highlight-bar-pink:
    backgroundColor: "{colors.highlight-pink-mark}"
---

# owlit design

owlit is a Mac app for reading, writing and thinking through papers with an assistant called Owlit. A workspace is a folder; papers, notes, docs and chats live in it as files. The interface is a quiet, paper-toned desk: one sheet, five places, and an assistant that marks its work in one colour and otherwise stays out of the way.

**What this file is.** owlit's visual system: the tokens (front matter, mirrored in `app/src/index.css`) and the rules that generate them. It says how things look, not what they do; behaviour is in the code, with its reason in a comment where it is implemented. A rule is here because it holds everywhere; a value that holds in one place lives in that place's code. Shared looks are shared components in `app/src/components/` (the shapes below), built on the shadcn primitives in `components/ui/`: change the component, then this file, never one call site. `npx @google/design.md lint DESIGN.md` reports no errors; its contrast warnings are on translucent fills it can't read, and its orphans (`border`, `input`) are tokens the format can't attach to a component.

## Overview

### Five rules

1. **Paper, not steel.** Every neutral carries a faint warm tint (hue 60 to 85, chroma under 0.012), so greys read as paper. Surfaces are opaque and step lighter from the back of the window to the front: frame, list panel, sheet, card, popover. The brightest thing on any screen is what you read or act on: a PDF page, the composer, a card. Depth is told by that lightness, then a hairline, and only what floats gets a shadow.
2. **Quiet by default.** A row at rest is its name and one line of muted detail. Actions appear on hover, focus or an open menu. Nothing is counted in a badge; a count that earns its place is a muted number at the end of a line. A finished thing goes quiet.
3. **One ladder of states, one mark per rung.** Everything that can have a state sits on one ladder, each rung with one mark, the same everywhere: *fine* is nothing at all; *working* is a quiet grey (a breathing ring, a shimmer on the words, a muted spinner on the row at work); *changed since you last looked*, only for what Owlit did, is the `note` dot, gone once seen; *waiting on you* is the `warning` shield, a shape, so it never passes for the dot; *broken* is `destructive`, red, and only here.
4. **Every colour says one thing.** Neutrals carry the whole interface. Each other colour has a single meaning and draws marks (words, dots, rules, underlines), never washes. Paper tones never touch a mark. Two states that both matter are never told apart by colour alone.
5. **Three voices stay apart.** What you wrote, what a paper says and what Owlit thinks are drawn differently and signed. Owlit's words are signed "Owlit"; its edits are a second editor's ink (`suggestion`); its notes are an amber line under your words (`note`). The agent underneath is named only where it is picked, and its own output is quoted as a detail, in monospace, never as the answer.

### Habits

- **Sentences, not labels.** Short plain English: "Owlit wants to edit untitled.md", "Changed since you last looked", "Read 3 files". Headings are one or two words in sentence case. Counts read as words ("3 notes", "a paper", "2 of 3"); recent times are relative ("2 h ago"), older ones short dates ("Mar 3"). An ellipsis marks a continuing action ("Checking…", "Manage agents…").
- **Words before marks.** Text before icons; menu items are words only; an icon-only action keeps its label in a tooltip; an explanation sits behind an info icon, unless a setting can't be chosen well without it, and then it is one muted line under the setting's name.
- **One line per thing.** A row is a title, one muted detail inline, one detail at the right end. It earns a second line only for a problem, or for words the person typed; when it is a problem, that line holds the fix.
- **Same thing, same look.** A row, a ⋯ menu, a find field, a card, an empty state, a mention token look the same in every place. A right-click opens the same menu as the row's ⋯. A new feature copies the nearest existing shape before inventing one; when a shape must change, it changes everywhere.
- **Process folds, results lead.** What the agent did is a quiet, foldable list; the answer is full-width body text.
- **Undo, not confirm.** Deleting, removing and dismissing happen at once and leave a toast with Undo. Nothing asks "Are you sure?".

### Vocabulary

**Owlit** is the assistant; everything it says, edits or leaves is signed Owlit. **Ask Owlit** is the one name for sending a passage or question to it (the feather in icon rows). **Agent** is the local coding agent underneath (Claude Code, Codex, Gemini CLI, a custom command), and the agents it hands work to; **connector** is reserved for data sources and MCP servers. **Steps** are one answer's thoughts and tool calls. The **agent window** is the app-wide place to talk to Owlit: the **ask bar** at the bottom of a page, and the **panel** docked beside it. **Knowledge** holds **topics**; a topic is **lines**, each with a speaker; a **connection** is an item on a paper's Knowledge tab. The **places** are Home, Chat, Docs, Knowledge and Library.

### Brand

The mark is a feather: one hand-drawn, round-ended line that curls back on itself three times, in the text's own ink, never filled, outlined, shadowed or tinted. As an icon (`OwlitMark`) it is drawn to lucide's measure: the line fills 20 of 24 units of its square and its stroke is 2 of 24, so it sits beside lucide icons as one of them. It stands only for Owlit: the top bar's toggle for the agent window, Ask Owlit in the highlight toolbar, the app icon. It is never decoration.

The wordmark is lowercase "owlit" in Dosis 500 slanted 12° (Dosis has no italic, so the slant is a skew). The lockup (`OwlitLockup`) puts the feather before the word, drawn with a thinner line than the icon, its height 1.35 times the ascender of the "l", as outlined paths so no font is needed; it appears once, on the welcome page. The Chat greeting is set in the wordmark's face, 44px, skewed 12°, in the foreground at 90%; nothing else uses Dosis. In the interface the name is plain text.

The app icon is a squircle tile in a light paper gradient with a soft drop shadow and a hairline edge, the feather on it in near-black ink; the dark icon keeps the shape on a dark warm tile.

## Colors

Every colour is a semantic token; feature code never touches the raw palette.

**Surfaces are opaque and step lighter toward the front.** State fills (`muted`, `secondary`, `accent`, `sidebar-accent`) are translucent tints of the text colour, so a hover on any surface, or a chip on a hovered row, is always one visible step; two opaque greys would eventually collide.

| Layer | Token | Light | Dark |
|---|---|---|---|
| Frame: top bar, icon rail, the window behind the sheet | `sidebar` | 0.942 | 0.155 |
| Panels: list panel, docked agent panel, the reader's well | `sidebar-panel` | 0.976 | 0.19 |
| Sheet | `background` | 0.99 | 0.215 |
| Raised: composer, fields, cards, the active rail button | `card` | 1.0 | 0.245 |
| Floating: menus, pills, dialogs, toasts | `popover` | 1.0 | 0.255 |

Dark mode keeps the warm tint and the steps, lifted off pure black, and lightens the marks. Four **paper tones** (Warm, Neutral, Slate, Sepia; Settings › Appearance) swap the whole neutral family at once and keep Warm's lightness steps, so depth reads the same; the desktop shell paints the window in the tone's frame colour before the first frame is drawn. There is no accent colour to pick: filled buttons are the tone's near-black (`primary`).

**Marks.** Each has one meaning, in both themes, and is deep enough to carry it alone (3:1 on every fill it sits on):

| Token | Means |
|---|---|
| `warning` | Waits on you: the needs-you dot, the shield beside a permission or question, the triangle on an agent that can't run |
| `destructive` | Broken, or an action that removes. A removal Owlit proposes, a step you declined and a reply you stopped are not errors and get no red |
| `success` | Rare: a check beside a value a service accepted |
| `suggestion` | Owlit's proposed words, drawn as text with an underline, the strike through what they replace, the rule beside the lines, and "+n" in a result card. Never a wash behind text |
| `note` | Owlit was here: the 8px dot for what it changed since you looked (rimmed in `note-rim`, so it holds 3:1 on light panels and hovered rows), the 2px underline and wash of a note on a passage, the open note's left rule |
| `mention` | A thing in the workspace named in text: paper, doc, topic, chat; also link hotspots and the passage ring in a PDF |
| `star` | Yours: the small filled star after a starred title |
| `text-highlight` | Your `==highlight==` in a doc, the same lemon as a yellow PDF highlight |
| `tag-*` | Eight low-chroma hues, one per tag by its name, only ever a 6–8px dot before the name |

**PDF colours don't follow the theme.** A page is white in both, so the four highlight colours, the selection and the find colours are fixed, drawn with multiply so the ink stays black; the `-mark` twins of the highlight hues are deep enough for a 3px bar in the highlights list and the dots in menus, off the page. Anything pointing at a passage on the page (a link hotspot, the passage ring) is `pdf-link`, the light theme's mention blue. The highlight colours have no meanings; the reader decides.

**Contrast.** Readable text is AA (4.5:1) on every surface it can sit on, hover and selection included. Secondary text is `muted-foreground` at full strength, never faded further; the one sanctioned middle is `foreground` at 80%, for a line that leads a folded block and the model's name in the picker. To calm a colour, lower its chroma; don't add `muted-*` twins. Opacity is for fills (`bg-destructive/10`, `bg-foreground/8`), not for text.

## Typography

One face, six sizes, two weights. **Figtree** everywhere: 22px for page titles (medium) and a doc's first line (semibold, so it outweighs the headings under it), with tight tracking and leading; 18px for a paper's title in its panel (medium) and for `#` and `##` in a doc (semibold); 15px for body, wherever people read and write (messages, the composer, docs at 1.7 line height, notes, topic lines); 14px for the interface (rows, buttons, dialogs); 13px for secondary text (meta, descriptions, breadcrumbs, small buttons, a row's right-hand detail); 12px for captions (group labels, counts, chips, keys). The three steps Tailwind has no name for are theme sizes: `text-title` (22px), `text-body` (15px), `text-detail` (13px). 16px appears only as a dialog's section title, the palette's input and a doc's `###` and deeper headings (semibold, a step over its body so weight isn't all that sets them apart). Weight carries hierarchy before size or colour: regular for text, medium for titles, the active item, button labels and a speaker's name; semibold only for headings in a doc or an answer and for bold. Numbers that line up (counts, pages, dates in a column) are tabular; long titles are balanced; truncation ends in an ellipsis and the full text shows on hover.

**Dosis 500, skewed 12°**, is the greeting's face and nothing else: a narrow display face that tires at small sizes. **Monospace** (system, 0.85em on `muted`, or 13px in a block) is for what a machine said or takes: commands, keys, paths, an agent's raw message. A sentence about them is never monospace.

Rendered Markdown (answers, digests, the paper note) keeps headings at 1.25/1.1/1rem semibold, lists with a 1.5rem indent, quotes behind a 2px muted rule, tables ruled and never boxed, display math centred on its own line.

## Layout

The window has no system title bar: a 40px top bar in the frame colour drags the window (on macOS the traffic lights sit at its left and the first button starts after them), then a 4px gap around one sheet with 10px corners and a hairline border. The top bar holds back, forward, the list panel toggle and, at the right end, the feather that docks the agent window. A 40px icon rail at the left lists the places, 32px buttons 4px apart, Settings alone at the bottom.

The sheet is split by half-pixel hairlines into a 260px list panel (Chat and Docs only), the page, and, when open, the docked agent panel (400px by default, 320px at least, resizable from its left edge; a narrower window narrows it before the page). Panels show and hide at once, with no slide, and the list panel folds while the agent panel is open so the page keeps its column. On a paper, the details panel (380px by default, at most half) and the agent panel share one slot at the right.

Reading and writing share one centred 768px column with a 16px gutter (24px in a doc): chat, a doc, a topic, Home, the Knowledge list, the welcome page. Only the Library, which has a table, uses the 1152px column (a 24px gutter and a 40px top), for every tab and layout so switching never moves the header; a page of rows alone stays in the reading column so a line never runs the width of the window. Pages scroll whole, header included. A paper, a doc and a topic open under a 44px header: a 13px muted breadcrumb at the left that starts at the sheet's edge, not the text column, and ghost icon buttons at the right.

Rows are 36px, 2px apart, so two filled neighbours never merge; the docs tree, menus and result cards use 32px because they run long or sit tight, and menu rows touch. Grouped lists keep a ladder: 4px from a label to its rows, rows 2px apart, 20px between groups, 24px between sections on a list page, 40px on a topic page. Dividers stop at the text edges.

### The places

What each place is made of, in the shapes below; the measures that hold in one place are in its code.

- **Home.** The workspace's name as the page title; first, under "Continue", the last thing worked on as a row with a quoted passage of the person's own last words; then "Waiting on you", only while something waits, under a label with the shield; "Since you left" rows after three days away; "Recent". All of it is plain rows, no cards, so Home has one kind of row; three or more papers waiting for the same thing share one row in the plural, "and 5 more". An empty workspace shows three ways in as rows and the keys worth knowing, not a checklist.
- **Chat.** The list panel: a search button, a New chat row, chats grouped by time, every row with a status slot. The page: messages in the reading column fading into the sheet above the composer; with no chat, the greeting, the composer and starter chips. Waiting cards sit above the composer.
- **Docs.** The list panel: the workspace folder as a tree. The page: the doc's Markdown in the reading column, marks hidden away from the cursor, Owlit's edits and notes drawn in place. Docs has no landing page; it opens the last doc.
- **Knowledge.** The reading column: a find field once the list is long, topics as rows with their summary inline, "This week" and "Earlier" only when both exist, archived topics folded away. A topic: its name, "Updated …", the summary quoted, then "Your questions", "So far" as speaker-column lines, "Sources" and "n changes" folded.
- **Library.** The wide column: the title with its underline tabs (Up next, All papers) on the same line, sort and the List / Table toggle at that line's end, one find-and-add field, filter chips with the tag filter at the right, then rows grouped by date or a ruled table. Up next lists the papers being read, then the newest unread ones with a PDF. A list row is the paper row: the status slot, the title, its details (authors · year, a venue only by its acronym) in a column at the right, then ⋯ and the star, a starred paper's star always showing so a list's stars line up. The table leaves out a column no paper in view fills, and a venue is its acronym or its full name cut by the cell, never made-up initials. A row opens in place as a peek; two or more selected papers raise the bulk bar. A paper: the reader on its well under a breadcrumb bar, floating pills for zoom, find and the page number, the details panel at the right with underline tabs (Notes, Highlights, Knowledge, About), opening on the last one used, Notes at first. A paper without a PDF shows the drop card on the well.
- **Settings.** One dialog over the app (760–800 by 580px): a 200px section list on the panel colour at the left, the section at the right under its 16px title and info icon, every section a bordered list of 48px rows. There is no Save button; fields commit on blur or Enter.
- **Welcome.** A 460px column: the lockup, one sentence, a card asking what Owlit should call you, a two-row card (Create a workspace, Open a folder you have), Recent as rows, one line at the bottom saying which agent will run. No rail, since no place exists yet.
- **Everywhere.** ⌘K opens the palette, a dialog at 18% from the top; ⌘J the ask bar (the page fades out under it, and with its input empty it offers ⇧⌘J "Last chat", the chat's title in a tooltip); ⇧⌘J the panel; ⌘, Settings; ⌘/ the shortcuts dialog, a bordered list per group.

## Elevation & Depth

Tone first, then a hairline, then a shadow, and only what floats or is acted on gets one. Three materials:

- **Sheet.** The background. Pages, rows, steps blocks and result cards sit directly on it with a hairline border and no fill. Content never casts a shadow.
- **Card.** `card` with a hairline border and the small shadow: the composer and the ask bar, a peek, the waiting cards. Without a shadow: bordered lists, fields, the welcome choices. The composer deepens to the medium shadow while focused.
- **Floating.** `popover` with a 1px ring of the foreground at 8% (14% in dark) and the large shadow: menus, popovers, the mention popup, the reader's pills, the highlight toolbar, the bulk bar, the scroll-to-bottom button, toasts. In code it is one utility, `menu-surface`; corners and text colour stay with each shape. Dialogs are the same material with a 10% ring over a black-at-10%, lightly blurred overlay. Tooltips invert: foreground fill, background text, with a small arrow; a key inside one is a translucent chip.

**Focus** marks appear only after keyboard navigation (Tab, arrows, Esc): a pointer press, or typing inside a field, does not count, and a control that regains focus after a click shows nothing. Buttons and tabs take a 3px ring of `ring` at 50%; rows and text buttons take their hover fill; fields darken their border to the foreground at 30% however focus arrived, never a ring. An error reddens a field's border. The composer darkens its border to 20%.

**Motion** explains a change and never decorates. Something that changes size or place in front of the person moves there, so the eye can follow: a peek, a folding block, Owlit's note and a waiting card grow from their line and push what is below them, a tab's underline or a segment's thumb travels to the chosen one, Undo draws its strike from the left, all over 180ms (`--t-layout`). A mark on the ladder fills in or leaves rather than popping: a fill grows from the ring's centre and the shield crossfades over 150ms (`--t-mark`), and the `note` dot is the one slower exit, fading and shrinking over 400ms a moment after its row has been seen. What the person summoned appears at once: panels and page switches never slide; menus, popovers and dialogs fade and scale in from 95% over 100ms (`--t-menu`), hover-only controls fade their opacity, and every move shares one easing (`--ease`, with the durations in `index.css`). Three small animations say "alive" without a spinner: a chat at work breathes its status ring over 1.6s, an in-progress sentence shimmers, a highlight or passage reached from a list rings twice and goes quiet; where a load may be fast (the reader), the spinner waits 300ms before it shows. Reduced motion stops the breathing and every move of size or place, and keeps only the fades.

## Shapes

10px is the base: the sheet, cards, bordered lists, default buttons, fields, code blocks, steps and result cards. 14px for what floats or is typed into: the composer, the ask bar, find fields, menus, dialogs, attachment chips, a peek. 8px for what sits inside those: rows, menu items, chips, small buttons, the selection menu. 6px for the smallest: keys, a tag chip's remove square. 18px for the dashed drop card. Full for pills: filter chips, starter chips, the round Send and plus, the reader's pills, dots. Nested corners are concentric (outer radius = inner + padding), and a larger shape inside a smaller one takes the larger radius rather than stacking two alike.

Lines are one hairline in `border`, translucent in dark mode; half-pixel lines divide the panels from the sheet. A resize edge is invisible until hovered, then a 2px line in the border colour.

## Components

The shared shapes. Each is one component in code; a place uses it as it is.

- **Rail button.** 32px, muted icon, 8px corners; the active place is lifted on `card` with the smallest shadow. A place that needs you carries a 6px `warning` dot at the top right of its icon with the reason in its tooltip, the rail's only mark. The gear sits at the bottom, apart, and never takes the active look.
- **Row.** 36px, 8px corners, 10px side padding, 14px text: an optional 20px slot for a mark, the title, one muted 13px detail inline, one at the right (a count, a site, the date). It fills with `muted` on hover and `accent` while selected or while its menu is open, and keeps keyboard focus visible with the same fill; a date at the right gives way to the row's actions on hover. Rows in the rail and panels use the `sidebar-accent` fill, and the open item adds medium weight. A row never fills with a colour of its own. The docs tree's rows are 32px, indented 14px a level, with a chevron-wide slot on every row so names line up.
- **Row actions.** A 24px ⋯ square at the row's end, visible on hover, focus or while its menu is open, that darkens on its own hover; the title makes room only then. A right-click opens the same menu where the pointer is. Renaming is an input of the row's own height and corners on `card`, the text where the name was.
- **Status slot.** In a list whose rows can have a state (chats; papers in the Library list, at 16px), every row keeps the slot so a state fills in without moving anything. A paper's slot is empty while unread, a half-filled muted ring while it is read, and the `warning` shield while its publisher waits on you. At rest it holds an 8px hollow ring (a 1.5px muted stroke), there to line titles up; the ladder's marks fill it: a breathing muted fill at work, the `note` dot once finished since you looked, red when broken, the `warning` shield while it waits on you. New chat and New doc put their 18px round plus in the same slot, so switching panels moves nothing.
- **Note dot.** 8px, `note` with a 1px inset rim of `note-rim`: before a changed topic or line, in a tab's label, on Home's rows, in the status slot. It leaves once the thing has been on screen for a moment.
- **Group label.** 12px `muted-foreground`, regular weight, 4px over its rows, with the rows' side padding. Never a heading, never a count. A **fold** ("Sources · 4 docs", "5 changes", "2 earlier steps", "Show 4 more") is a 13px muted text button with a chevron that turns when open.
- **Menu.** Floating material, 14px corners, 6px padding, items 32px with 8px corners and 10px side padding on the `accent` fill when highlighted. Words only; the chosen item has a muted check at the right, a state shows as a chip in the same slot; a submenu holds choices; groups are divided by a hairline, in the order what changes the thing, where it is, then Delete or Remove, in red, which fills solid red with white text when highlighted. A menu's width fits its longest item. A plain-text trigger ("Unread ▾", "Recently added ▾", a Settings picker) is a ghost button in regular weight that fills while open.
- **Search button.** At the top of a list panel: a 36px button drawn like a field (`card`, a 70% border, magnifier, "Search", the ⌘K key) that opens the palette.
- **Find field.** 44px, 14px corners, `card`, a muted magnifier at the left, the "/" key or a clear button at the right, 15px text. One per list; it finds and, in the Library, adds. It appears only once a list is longer than a screen.
- **Field.** 32px, 10px corners, the `input` border, no fill, no shadow; focus darkens the border, an error reddens it. Forms are one field per line, a small muted label above, an optional hint below, actions right-aligned with the primary last. A secondary form stays folded behind a text button and unfolds as a bordered `card` panel with a short title. Settings fields commit on blur or Enter; there is no Save button.
- **Buttons.** 32px with 10px corners and medium weight; small ones 28px, the smallest 24px, both with 8px corners and 13px or 12px text. **Primary** fills with `primary` and is the one filled button in a group (Send, Add, Apply, Allow, Create); **outline** is the second choice beside it; **ghost** is everything else, muted text that darkens on hover; a destructive action is a ghost button in red or the last menu item, never a red fill. Icon buttons are square, ghost, muted, with their label in a tooltip. A text button inside a muted line (Retry, Undo, Show all, Skip) is muted, regular weight and 13px, 24px tall with 6px side padding so it is easy to hit, and takes the `muted` fill on hover and keyboard focus. The composer's Send and Stop are round and filled; its plus is round and ghost.
- **Segmented control.** A `muted` box or pill with 2px padding (List / Table, System / Light / Dark); the chosen segment is lifted on `card` with the smallest shadow. A page switch is an **underline tab**: 14px medium at 60% that goes full on hover and carries a 2px underline when active. A filter is a **filter chip**: a 28px pill, 13px muted, with its count in 12px, that takes the `accent` fill when pressed. They never look alike. Controls with nothing to act on are hidden, not shown empty.
- **Chips.** *Status*: a 12px word on `muted` (or a red tint for an error), 8px corners, in a row's right slot. *Tag*: 24px, 8px corners, `muted`, a dot and the name, a remove square on hover. *Context*: 24px on `muted`, above an input, naming where a passage came from ("p. 4 · “…”") before its words, with a cross to drop it. *Starter*: words on `secondary`, full, regular weight, no outline, no icon. *Attachment*: `card` with a hairline border and 14px corners, the file's icon or picture in a `muted` square, the name in medium and one muted 12px line; a problem turns the line red with a faint red border, a caution adds the `warning` triangle. A file owlit already has is never a chip; it is a mention.
- **Key.** A 20px chip: `muted`, 12px medium muted text, 6px corners. In a field or next to a row it loses its fill; in a tooltip it is translucent. Every key shown anywhere comes from one table, and a tooltip shows the key after the label.
- **Mention.** `mention` text with 0.3em corners and 0.2em side padding: a faint `mention` fill in an input so it reads as one token; plain in text, filling only on hover; the full title on hover. A wikilink to a doc that exists is a mention; one that doesn't is muted with a dotted underline. The "@" popup is floating material, 416px wide, with a row of 12px filter tabs and the Tab key, group labels, and rows with a source icon, the title and a 12px subtitle.
- **Quoted passage.** One muted line behind a thin left rule: the words you sent with a message (ruled at the right, under the bubble), a line's source on a connection, your last words on Home, a topic's summary.
- **Table.** Ruled, not boxed: a tinted header with rounded ends and medium text, a hairline under each body row, square cells, no frame, no column lines. The same in answers, docs and the Library, where the header is sticky on a 4px band of sheet and columns give way least-needed first.
- **Card.** `card` at 10px with a hairline border and no shadow; its border darkens on hover when the whole card is a link. A **bordered list** is the same box with hairline dividers and one line per row: dialog content, Settings sections, the welcome choices, a question's options. A **peek** is a row opened in place as a card at 14px with the small shadow: the full title, authors and venue, the abstract, one line of controls ending, a little apart, in a filled Open (Continue while it is being read; never "Read", which beside the status menu would pass for marking it read); clicking its background folds it.
- **Composer.** The only lifted input: `card`, 14px corners, the small shadow; a 15px editor at least 56px tall, attached files above the text as chips, a footer with the round plus at the left and the pickers and round Send at the right. Its pickers are 28px ghost text buttons with no chevrons: the agent as its mark alone (an amber triangle or a spinner takes its place when it needs you), the model at 80% with the effort muted after it, Owlit's role in full; each has a tooltip saying what it holds. A one-line banner inside it is the only place it says something is wrong. The **ask bar** is the same material with the medium shadow, 600px at most, 16px above the page's bottom: one 48px line with a context chip, the input, the name of the chat ⇧⌘J brings back, and Send.
- **User bubble.** At the right, up to 80% wide, `secondary` fill, 14px corners, 15px text. Owlit's reply is plain Markdown at 15px with no bubble. Each message's actions hang 28px below it as 24px ghost icon buttons, shown on hover, with the model and time in 12px muted before them.
- **Folding block.** Process that recedes (steps, agents handed work, a plan): one 14px line in `foreground` at 80% with a chevron, saying in a sentence what it holds; it shimmers and stays open while working, closes when the answer starts. Opened, it is a bordered list at 10px of plain muted sentences at least 36px tall, no kind icon, one muted detail at the right, and the ladder's marks for a waiting or broken row ("Failed" in red after the sentence; a declined step says "Not allowed", muted). A row that holds something opens to it in a `muted` 13px box underneath. Neighbouring steps of one kind fold into "Read 3 files"; while it runs only the last three show behind a "2 earlier steps" row. A plan is a ruled checklist with "done of total".
- **Result card.** What Owlit changed outside the chat, under its answer: a hairline border at 10px, 4px inside, 32px rows that sit tight with no dividers. Each row is a muted kind icon, the name, and one muted detail (an edit's "+N −M" with the additions in `suggestion`, "Added", "3 notes"). The whole row goes to the thing, so hover gives it the `muted` fill and a go-to arrow (↗, not a chevron) in a slot kept at its end; Undo is a text button that appears before the detail on hover. Several rows get a summary line with Undo all. An undone row is muted and struck through.
- **Waiting card.** What waits on you sits above the composer, not among the messages: `card` with the composer's border, radius and shadow, a step less roomy. The `warning` shield, what Owlit wants in medium weight, a muted summary, a preview in a bordered box cut with a fade, then owlit's own buttons (Allow primary, Always allow outline, Don't allow and Never allow ghost) or a question's choices as a bordered list numbered in 12px muted, the pick in medium on `muted`. One decision never shows two sets of buttons; the composer's placeholder says what typing does instead.
- **Broken block.** A reply that broke is a bordered block in the result card's frame, never a wrapping line: a red × and "Owlit stopped" with Details, Dismiss and Retry as text buttons on that line, then why, in owlit's words, muted, under it. The agent's own words are behind Details, in a `muted` monospace box. A reply you stopped keeps its partial answer with "Stopped, partial" under it, muted, at all times.
- **Owlit's edit.** The same in a doc, a note, a step and a preview: new words in `suggestion` with a 1px underline, removed words muted with a 1.5px strike in `suggestion` (different in shape as well as tone), a 2px `suggestion` rule down the left of every touched line and of the line under them, "Suggested by Owlit" in 13px muted with Discard (ghost) and Apply (filled, 28px). Removal is never red.
- **Owlit's note.** A 2px underline in `note-rim` (the deeper amber, since it carries the meaning alone) under exactly the words it is about, below and thicker than a link's; no icon, no margin, no column. Open, the words take a `note` wash and the note pushes the text down as a `card` with a hairline border and a 3px `note-rim` rule at its left: who and when in 12px muted (with "2 of 3" and chevrons when there are several), the note in 14px drawn as Markdown, a bare owlit:// address shown as a mention under its short name ("Chan et al. 2026, p. 13"), Dismiss and Chat about this as text buttons at the bottom right.
- **Selection menu.** Over a selection in a doc or a note, one 24px "Ask Owlit" row in a 2px frame with 8px corners on `popover`, 8px off the selection, covering as little text as it can. A right-click gets the system's menu, with Ask Owlit first.
- **Reader.** Pages on the well with 24px around and 16px between them, each white with a hairline `pdf-page-edge` (under a 12% black shade in the dark theme, marks included, unless Settings › Appearance turns it off), fit to width by default. Nothing sits above the document: zoom and find share one **floating pill** (32px, full radius, 12px muted text, 24px round items) at the top right, the page number sits in another at the bottom centre and fades once scrolling stops, and a "← 4" way back joins it after a link. Highlights tint the page with multiply and deepen one step under the pointer; a commented one shows its comment on hover in a small floating box; nothing else marks it. A passage pointed at from Knowledge gets a 2px `pdf-link` ring 4px out from its text that pulses twice and goes.
- **Highlight toolbar.** Beside a selection or a clicked highlight, in the floating material at 14px: four 18px colour dots with a check on the current one (in `pdf-ink`, since the page is white), a divider, then 28px ghost icon buttons with tooltips: Copy, Comment, Ask Owlit (the feather), Delete on a highlight. Comment opens a three-line field inside it.
- **Highlights list.** By page under group labels: each a 3px bar in its `-mark` colour, up to four lines of 14px text, the comment under it, "Added by Owlit" when it was, ⋯ on hover; the active one takes `accent`.
- **Speaker column.** A Knowledge line anywhere: the speaker as a verb phrase in a 112px column (name medium, verb muted, 13px), the sentence in 15px, then in 13px muted its sources as mentions and its condition as a sentence. A line fills lightly on hover and when open, when its history rules off under it with dates in a 72px column.
- **Drop card and empty place.** Where something can be added and nothing is: a dashed box (1.5px at 15%, 18px corners) with a 15px medium line, one muted sentence, one or two small buttons (primary first), and the whole page still takes the drop, drawing a dashed overlay inside the sheet while a file is over it. An empty place is the same two lines centred in a narrow column, in the dashed card when there is a way to start, with at most one 13px line under it (the one key worth knowing, or a status that is true now). A missing thing says so the same way with a "Back to …" outline button. No illustration, nothing to dismiss; it goes when content arrives.
- **Tooltip.** The label, then the shortcut as a key chip; 12px on the inverted material with an arrow. An **info icon** is a 20px round target around a 14px muted icon, its tooltip below and at most 288px wide; a dialog's title carries one instead of a description.
- **Toast.** Bottom right, floating material at 10px: the message, a muted description, an Undo action. It moves left of a docked agent panel.
- **Settings row.** 48px in a bordered list: the name with an optional info icon at the left, the control at the right, and a second 13px line only for a problem (red), an open form, or a muted line of help where the choice depends on it (Background work, the contact email and keys, how PDFs are read, the name, the privacy switch). Controls end on one right edge; text and icon buttons that come last pull out by their own padding so their text lines up with a switch or field; hover-only actions sit left of what always shows, so nothing moves. A key shows as "••••ab12" in monospace with Change and Remove; a `success` check sits in the control's slot once a service accepted a value, so the row keeps its height. The tone picker draws each tone as a small picture of the app in that tone's own tokens, with a 2px `foreground` ring on the chosen one.

## Do's and Don'ts

Do:

- Reach for tone before lines, words before icons, and a shape before a second colour.
- Put the fix next to the problem.
- Keep a concept's look identical everywhere, and change the component when it must change.
- Check contrast on hover and selection fills, not just the bare surface.
- Keep a value that holds in one place in that place's code, with its reason.

Don't:

- Mark a healthy state with a dot, a label or "Connected"; the status slot's faint ring is the one exception.
- Tell two states apart by a shade of one colour, or use red for anything the person chose.
- Count, group or badge what Owlit did; the `note` dot is the whole mark, and nothing Owlit wrote carries an accept, confirm or triage control.
- Show an agent's or a library's words as the answer or the error; quote them as a detail.
- Put icons before every menu item, ticks after finished steps, spinners where a fill will do, or coloured cards around process.
- Name a step by its command line or a tool's internal name, or put a decision's buttons in the middle of the messages.
- Use two lines where a title plus an inline muted detail fits, or show reading progress in a list.
- Use raw Tailwind palette colours, opaque grey fills, opacity on readable text, focus rings on fields, Dosis outside the greeting, or sizes outside 22, 18, 15, 14, 13 and 12px (and the few 16px places under Typography).
- Box a table, outline a chip beside a bordered surface, override a menu's padding or radius in one place, or squeeze several inputs onto one line.
- Write a description under a dialog title, a label on a self-explanatory icon, or leave a secondary form open.
- Slide a panel, animate a list, or ask "Are you sure?" where Undo will do.
- Hide the one thing the person needs (a fix, a full title) behind a tooltip.
- Write into this file what a control does, when a state changes, or a number that holds in one place.
