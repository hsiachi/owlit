---
version: alpha
name: owlit
description: A quiet, paper-toned desk for reading, writing and thinking through papers with Owlit. One sheet, a few places, an assistant that marks its work in one colour and otherwise steps back.
colors:
  # Light mode, warm tone. Dark values and the other tones are in app/src/index.css, the source of truth.
  # Surfaces, back to front
  sidebar: "oklch(0.942 0.007 95)"
  sidebar-panel: "oklch(0.976 0.004 95)"
  background: "oklch(0.99 0.002 95)"
  card: "oklch(1 0 0)"
  popover: "oklch(1 0 0)"
  # Text
  foreground: "oklch(0.21 0.008 60)"
  muted-foreground: "oklch(0.505 0.012 65)"
  primary: "oklch(0.25 0.008 60)"
  primary-foreground: "oklch(0.985 0.003 95)"
  # State fills: translucent tints of the text colour
  muted: "oklch(0.3 0.02 65 / 5%)"
  secondary: "oklch(0.3 0.02 65 / 5%)"
  accent: "oklch(0.3 0.02 65 / 6%)"
  sidebar-accent: "oklch(0.3 0.02 65 / 6.5%)"
  # Lines
  border: "oklch(0.905 0.006 95)"
  input: "oklch(0.9 0.006 95)"
  ring: "oklch(0.7 0.012 70)"
  # Marks: one meaning each, unchanged by paper tone
  mention: "oklch(0.48 0.09 255)"
  warning: "oklch(0.66 0.12 70)"
  destructive: "oklch(0.55 0.16 25)"
  owlit: "oklch(0.5 0.11 155)"
  owlit-mark: "oklch(0.6 0.12 155)"
  text-highlight: "oklch(0.93 0.11 98)"
  # A person's mark: the foreground at 50% (3:1 like every mark), so it follows theme and tone (index.css makes it with color-mix)
  person-mark: "oklch(0.21 0.008 60 / 50%)"
  star: "oklch(0.66 0.13 88)"
  tag-red: "oklch(0.64 0.11 28)"
  tag-orange: "oklch(0.7 0.11 55)"
  tag-amber: "oklch(0.76 0.11 85)"
  tag-green: "oklch(0.64 0.08 125)"
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
  pdf-owlit: "oklch(0.6 0.12 155)"
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
  owlit-dot:
    backgroundColor: "{colors.owlit-mark}"
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
  row-list:
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
  waiting-dot:
    backgroundColor: "{colors.warning}"
  check-mark:
    textColor: "{colors.owlit}"
  code-block:
    backgroundColor: "{colors.muted}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
  owlit-edit-added:
    textColor: "{colors.owlit}"
  owlit-edit-removed:
    textColor: "{colors.muted-foreground}"
  owlit-note-underline:
    textColor: "{colors.owlit-mark}"
  owlit-note-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  doc-highlight:
    backgroundColor: "{colors.text-highlight}"
  reader-comment-underline:
    textColor: "{colors.person-mark}"
  reader-comment-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
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

**What this file is.** owlit's visual system: the tokens (front matter, mirrored in `app/src/index.css`) and the rules that generate them. It says how things look, not what they do; behaviour is in the code, with its reason in a comment where it is implemented; what owlit is and why is `docs/vision.md` and `docs/decisions/`. A rule is here because it holds everywhere; a value that holds in one place lives in that place's code. Shared looks are shared components in `app/src/components/` (the shapes below), built on the shadcn primitives in `components/ui/`: change the component, then this file, never one call site. `npx @google/design.md lint DESIGN.md` reports no errors; its contrast warnings are on translucent fills it can't read, and its orphans (`border`, `input`) are tokens the format can't attach to a component.

## Overview

### Five rules

1. **Paper, not steel.** Every neutral carries a faint warm tint (chroma under 0.012), so greys read as paper: surfaces and lines at hue 95, a warm ivory that matches the app icon's tile, text and state fills a little warmer, so they read as ink. Surfaces are opaque and step lighter from the back of the window to the front: frame, list panel, sheet, card, popover. The brightest thing on any screen is what you read or act on: a PDF page, the composer, a card. Depth is told by that lightness, then a hairline, and only what floats gets a shadow.
2. **Quiet by default.** A row at rest is its name and one line of muted detail. Actions appear on hover, focus or an open menu. Nothing is counted in a badge; a count that earns its place is a muted number at the end of a line. A finished thing goes quiet.
3. **One ladder of states, one mark per rung.** Everything that can have a state sits on one ladder, each rung with one mark, the same everywhere: *fine* is nothing at all; *working* is a quiet grey (a breathing ring, a shimmer on the words, a muted spinner on the row at work); *changed since you last looked*, only for what Owlit did, is Owlit's green dot (`owlit-mark`), gone once seen; *waiting on you* is the `warning` amber dot, and where it sits beside a time (the chat list) the word Waiting takes the time's place; *broken* is `destructive`, red, with the word Stopped the same way. Each rung is its own hue, so nothing is told apart by a shade.
4. **Every colour says one thing.** Neutrals carry the whole interface. Each other colour has a single meaning and draws marks (words, dots, rules, underlines), never washes. Paper tones never touch a mark. Two states that both matter are never told apart by colour alone.
5. **Three voices stay apart.** What you wrote, what a paper says and what Owlit thinks are drawn differently and signed. Owlit's words are signed "Owlit"; everything its hand leaves on your things is one green (`owlit`): the words it proposes, the line under a passage it noted, the dot on what it changed. The agent underneath is named only where it is picked, and its own output is quoted as a detail, in monospace, never as the answer. A shared doc's readers are a fourth voice: what they say is signed with their name and drawn in the text's own ink (`person-mark`), never a hue, so it can't pass for Owlit's or for a link.

### Habits

- **Sentences, not labels.** Short plain English: "Owlit wants to edit untitled.md", "Changed since you last looked", "Read 3 files". Headings are one or two words in sentence case. Counts read as words ("3 notes", "a paper", "2 of 3"), and a large one in a narrow cell is short in the language's way ("2.7K", "3.2万"); recent times are relative ("2 h ago"), older ones short dates ("Mar 3"); a clock time stands alone only for today, and another day's carries its date ("Oct 9, 12:01 PM"). An ellipsis marks a continuing action ("Checking…", "Manage agents…").
- **Words before marks.** Text before icons; menu items are words only; an icon-only action keeps its label in a tooltip; an explanation sits behind an info icon, unless a setting can't be chosen well without it, and then it is one muted line under the setting's name.
- **One line per thing.** A row is a title, one muted detail inline, one detail at the right end. It earns a second line only for a problem, or for words the person typed; when it is a problem, that line holds the fix.
- **Same thing, same look.** A row, a ⋯ menu, a find field, a card, an empty state, a mention token look the same in every place. A right-click opens the same menu as the row's ⋯. A new feature copies the nearest existing shape before inventing one; when a shape must change, it changes everywhere.
- **Process folds, results lead.** What the agent did is a quiet, foldable list; the answer is full-width body text.
- **Undo, not confirm.** Deleting, removing and dismissing happen at once and leave a toast with Undo. Nothing asks "Are you sure?".

### Vocabulary

**Owlit** is the assistant; everything it says, edits or leaves is signed Owlit. **Ask Owlit** is the one name for sending a passage or question to it (the feather in icon rows). **Agent** is the local coding agent underneath (Claude Code, Codex, Gemini CLI, a custom command), and the agents it hands work to; **connector** is reserved for data sources and MCP servers. **Steps** are one answer's thoughts and tool calls. The **agent window** is the app-wide place to talk to Owlit: the **ask bar** at the bottom of a page, and the **panel** docked beside it. **Knowledge** holds **topics**; a topic is **lines**, each with a speaker; a **connection** is an item on a paper's Knowledge tab. The **places** are Home, Chat, Docs, Knowledge and Library.

### Brand

The mark is a feather: one hand-drawn, round-ended line that curls back on itself three times. In the interface it is in the text's own ink, never filled, outlined, shadowed or tinted, and drawn to lucide's measure (`OwlitMark`) so it sits beside lucide icons as one of them. It stands only for Owlit: the toggle for the agent window, Ask Owlit, the app icon. It is never decoration.

The wordmark is lowercase "owlit" in Dosis 500 slanted 12° (Dosis has no italic, so the slant is a skew). The lockup (`OwlitLockup`) puts the feather before the word, as outlined paths so no font is needed; it appears only on the first launch and the welcome page. The i's dot is Owlit's green (`owlit-mark`), Owlit's mark on its own name, as on its work. In the interface the name is plain text.

The app icon is the one place the brand wears Owlit's green, because it lives outside the app; inside, green keeps its single meaning. It is the feather in `owlit` green on a warm-white tile (a light mint on graphite for dark), drawn with a heavier line at small sizes rather than scaled down. `apps/desktop/scripts/icon.mjs` builds every file from one description.

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

Dark mode keeps the warm tint and the steps, lifted off pure black, and lightens the marks. Four **paper tones** (Warm, Neutral, Slate, Sepia) swap the whole neutral family at once and keep Warm's lightness steps, so depth reads the same. There is no accent colour to pick: filled buttons are the tone's near-black (`primary`).

**Marks.** Each has one meaning, in both themes, and is deep enough to carry it alone (3:1 on every fill it sits on):

| Token | Means |
|---|---|
| `warning` | Waits on you, and nothing else: the dot on a rail icon, a Settings section or a chat row, and the triangle where no words can say it (an agent that can't run in the picker, a caution on a file chip) |
| `destructive` | Broken, or an action that removes. A removal Owlit proposes, a step you declined and a reply you stopped are not errors and get no red |
| `owlit` | Owlit's hand, at text strength: the words it proposes (underlined), the strike through what they replace, the rule beside the lines, "+n" in a result card, the check beside a value a service accepted. Never a wash behind text |
| `owlit-mark` | Owlit's hand, at mark strength: the 8px dot for what it changed since you looked, the 2px underline and wash of a note on a passage, the open note's left rule. A step lighter than `owlit`, still 3:1 on paper, so it needs no rim |
| `mention` | A thing in the workspace named in text: paper, doc, topic, chat; also link hotspots and the passage ring in a PDF |
| `star` | Yours: the small filled star after a starred title |
| `text-highlight` | Your `==highlight==` in a doc, the same lemon as a yellow PDF highlight |
| `person-mark` | Someone else's words on your doc: a shared doc's reader. The 2px underline under the words they commented on, its wash while open (`person-wash`), the open thread's left rule. Made from the foreground, so it is ink, not a colour |
| `tag-*` | Eight low-chroma hues, one per tag by its name, only ever a 6–8px dot before the name |

**PDF colours don't follow the theme.** A page is white in both, so the four highlight colours, the selection and the find colours are fixed, drawn with multiply so the ink stays black; the `-mark` twins of the highlight hues are deep enough for a 3px bar or a dot off the page. Anything pointing at a passage on the page (a link hotspot, the passage ring) is `pdf-link`, the light theme's mention blue. Owlit's mark on the page is `pdf-owlit`, the light theme's `owlit-mark`. The highlight colours have no meanings; the reader decides.

**Contrast.** Readable text is AA (4.5:1) on every surface it can sit on, hover and selection included. Secondary text is `muted-foreground` at full strength, never faded further; the one sanctioned middle is `foreground` at 80%, for a line that leads a folded block and the model's name in the picker. To calm a colour, lower its chroma; don't add `muted-*` twins. Opacity is for fills (`bg-destructive/10`, `bg-foreground/8`), not for text.

## Typography

One face, six sizes, two weights. **Figtree** everywhere: 22px for page titles (medium) and a doc's first line (semibold, so it outweighs the headings under it), with tight tracking and leading; 18px for a paper's title in its panel (medium) and for `#` and `##` in a doc (semibold); 15px for body, wherever people read and write (messages, the composer, docs at 1.7 line height, notes, topic lines); 14px for the interface (rows, buttons, dialogs); 13px for secondary text (meta, descriptions, breadcrumbs, small buttons, a row's right-hand detail); 12px for captions (group labels, counts, chips, keys). The three steps Tailwind has no name for are theme sizes: `text-title` (22px), `text-body` (15px), `text-detail` (13px). 16px appears only as a dialog's section title, the palette's input and a doc's `###` and deeper headings (semibold, a step over its body so weight isn't all that sets them apart). Weight carries hierarchy before size or colour: regular for text, medium for titles, the active item, button labels and a speaker's name; semibold only for headings in a doc or an answer and for bold. Numbers that line up (counts, pages, dates in a column) are tabular; long titles are balanced; truncation ends in an ellipsis and the full text shows on hover.

Chinese characters, which Figtree doesn't have, come from **PingFang SC** (Microsoft YaHei on Windows) at the same sizes and weights, while Latin letters and digits in the same line stay Figtree; the page's `lang` follows the interface language. Translated labels are given the room their words need rather than cut to the English width.

**Dosis 500, skewed**, is the wordmark's face, used only for the Chat greeting and the first launch's titles: a narrow display face that tires at small sizes. Chinese in it stands upright: slanted characters read as a faux italic. **Monospace** (system, 0.85em on `muted`, or 13px in a block) is for what a machine said or takes: commands, keys, paths, an agent's raw message. A sentence about them is never monospace.

Rendered Markdown (answers, digests, notes) keeps headings at 1.25/1.1/1rem semibold, lists with a 1.5rem indent, quotes behind a 2px muted rule, tables ruled and never boxed, code blocks wrapping their long lines rather than scrolling, display math centred on its own line.

## Layout

The window has no system title bar: a 40px top bar in the frame colour drags the window, then a 4px gap around one sheet with 10px corners and a hairline border. The top bar holds back, forward, the list panel toggle and, at the right end, the feather that docks the agent window. A 40px icon rail at the left lists the places, Settings alone at the bottom.

The sheet is split by half-pixel hairlines into a 260px list panel (Chat and Docs only), the page, and, when open, the docked agent panel (400px by default, resizable from its left edge). Panels show and hide at once, with no slide, and the list panel folds while the agent panel is open so the page keeps its column. On a paper, the details panel and the agent panel share one slot at the right.

Reading and writing share one centred 768px column with a 16px gutter (24px in a doc). Only the Library, which has a table, uses the 1152px column, for every tab and layout so switching never moves the header; a page of rows alone stays in the reading column so a line never runs the width of the window. Pages scroll whole, header included. A paper, a doc and a topic open under a 44px header: a 13px muted breadcrumb at the left that starts at the sheet's edge and always ends at the page itself, and ghost icon buttons at the right.

Rows are 36px, 2px apart, so two filled neighbours never merge; the docs tree, menus and result cards use 32px because they run long or sit tight, and menu rows touch. Grouped lists keep a ladder: 4px from a label to its rows, rows 2px apart, 20px between groups, 24px between sections on a list page, 40px on a topic page. Dividers stop at the text edges.

### The places

What each place is made of, in the shapes below; the measures that hold in one place are in its code.

- **Home.** The workspace's name, then plain rows only, no cards: Continue (the last thing worked on, with a quoted passage of your own last words), Waiting on you (only while something waits; each row's right end names its fix in muted text with a chevron, as Recent shows a date), Since you left (after days away), Recent. Many papers waiting for the same thing share one row in the plural. An empty workspace shows its ways in as rows, not a checklist.
- **Chat.** The list panel: a search button, a New chat row, chats grouped by time, every row with a status slot. The page: messages in the reading column fading into the sheet above the composer; with no chat, the greeting, the composer and starter chips. Waiting cards sit above the composer.
- **Docs.** The list panel: the workspace folder as a tree. The page: the doc's Markdown in the reading column, marks hidden away from the cursor, Owlit's edits and notes and readers' comments drawn in place; the header's ghost buttons say what is there in words ("2 notes", "3 comments", Shared).
- **Knowledge.** The reading column: topics as rows with their summary inline. A topic: its name, its summary quoted, its lines in speaker columns, sources and changes folded; changes Owlit made together sit under one date with their reason once.
- **Library.** The wide column: the title with its underline tabs, sort and the List / Table toggle on the same line, one find-and-add field, filter chips, then paper rows or a ruled table. A row opens in place as a peek. Work on the whole Library, such as an import, is one muted line on the ladder under the title, and its finished result is the page's one card. A paper: the reader on its well under a breadcrumb bar, the details panel at the right with underline tabs; once it has a digest, a Digest / PDF segmented control leads the header's buttons.
- **Settings.** One dialog over the app: sections at the left, named for what people come to do rather than by subsystem, the chosen one at the right. A section is groups parted by space, never by a box: a 14px medium heading over Settings rows, and an optional muted line under them for what the whole group shares, so no row repeats it. A section is never a single row on an empty page.
- **First launch and welcome.** No rail, since no place exists yet. The welcome writes the lockup over one sentence and a primary button. Each step is its words at the left and, at the right, a small owlit window drawn with the real parts running the step's demo. The welcome page is a narrow column: the lockup, one sentence, its choices as a row list, Recent as rows, one line saying which agent will run.
- **The reader's page** (apps/share-web). What a shared doc's link opens in any browser, for someone without owlit: the same tokens and shapes, drawn by hand since the page has none of owlit's components. The doc in the reading column, cited papers as rows, and one panel at the right for a paper or a thread, covering the page at phone width. Readers' comments look as they do in owlit.
- **Everywhere.** ⌘K opens the palette, a dialog at 18% from the top; ⌘J the ask bar; ⇧⌘J the panel; ⌘, Settings; ⌘/ the shortcuts.

## Elevation & Depth

Tone first, then a hairline, then a shadow, and only what floats or is acted on gets one. Three materials:

- **Sheet.** The background. Pages, rows, steps blocks and result cards sit directly on it with a hairline border and no fill. Content never casts a shadow.
- **Card.** `card` with a hairline border and the small shadow: the composer and the ask bar, a peek, the waiting cards. Without a shadow: fields. The composer deepens to the medium shadow while focused.
- **Floating.** `popover` with a 1px ring of the foreground at 8% (14% in dark) and the large shadow: menus, popovers, the mention popup, the selection menu, the reader's pills, the highlight toolbar, the bulk bar, the scroll-to-bottom button, toasts. In code it is one utility, `menu-surface`; corners and text colour stay with each shape. Dialogs are the same material with a 10% ring over a black-at-10%, lightly blurred overlay. Tooltips invert: foreground fill, background text, with a small arrow; a key inside one is a translucent chip.

**Focus** marks appear only after keyboard navigation (Tab, arrows, Esc): a pointer press, or typing inside a field, does not count. Buttons and tabs take a 3px ring of `ring` at 50%; rows and text buttons take their hover fill; fields darken their border to the foreground at 30% however focus arrived, never a ring. An error reddens a field's border. The composer darkens its border to 20%.

**Motion** explains a change and never decorates. Something that changes size or place in front of the person moves there, so the eye can follow: a peek, a folding block, a note and a waiting card grow from their line and push what is below them, a tab's underline or a segment's thumb travels to the chosen one, Undo draws its strike from the left, all over 180ms (`--t-layout`). A mark on the ladder fills in or leaves rather than popping (150ms, `--t-mark`); Owlit's dot is the one slower exit, fading over 400ms a moment after it has been seen. What the person summoned appears at once: panels and page switches never slide; menus, popovers and dialogs fade and scale in from 95% over 100ms (`--t-menu`), and every move shares one easing (`--ease`). Three small animations say "alive" without a spinner: a breathing status ring, a shimmer on an in-progress sentence, a passage reached from a list ringing twice; where a load may be fast, a spinner waits 300ms before it shows. Reduced motion stops the breathing and every move of size or place, and keeps only the fades.

The first launch is the one place where motion is the content, and even there it shows real gestures with the real parts at a small scale, never a mascot or confetti; the welcome writes the lockup with the feather as the pen. Reduced motion shows each animation's last frame, still.

## Shapes

10px is the base: the sheet, cards, a row's hover fill, default buttons, fields, code blocks, steps and result cards. 14px for what floats or is typed into: the composer, the ask bar, find fields, menus, dialogs, attachment chips, a peek. 8px for what sits inside those: rows, menu items, chips, small buttons, the selection menu. 6px for the smallest: keys, a tag chip's remove square. 18px for the dashed drop card. Full for pills: filter chips, starter chips, the round Send and plus, the reader's pills, dots. Nested corners are concentric (outer radius = inner + padding), and a larger shape inside a smaller one takes the larger radius rather than stacking two alike.

Lines are one hairline in `border`, translucent in dark mode; half-pixel lines divide the panels from the sheet. A resize edge is invisible until hovered, then a 2px line in the border colour.

## Components

The shared shapes. Each is one component in code; a place uses it as it is.

- **Rail button.** 32px, muted icon, 8px corners; the active place is lifted on `card` with the smallest shadow. A place that needs you carries a 6px `warning` dot at the top right of its icon, with the reason in its tooltip; Chat carries Owlit's dot the same way for a finished reply not yet seen. The rail has no other mark.
- **Row.** 36px, 8px corners, 10px side padding, 14px text: an optional 20px slot for a mark, the title, one muted 13px detail inline, one at the right (a count, a site, the date). It fills with `muted` on hover and `accent` while selected or while its menu is open, and keyboard focus takes the same fill; a date at the right gives way to the row's actions on hover. Rows in the rail and panels use the `sidebar-accent` fill, and the open item adds medium weight. A row never fills with a colour of its own.
- **Row actions.** A 24px ⋯ square at the row's end, visible on hover, focus or while its menu is open; the title makes room only then. A right-click opens the same menu where the pointer is. Renaming is an input of the row's own height and corners on `card`, the text where the name was.
- **Status slot.** In a list whose rows can have a state, every row keeps the slot so a state fills in without moving anything. At rest it holds an 8px hollow muted ring, there to line titles up; the ladder's marks fill it: a breathing muted fill at work, Owlit's dot once finished since you looked, the `warning` dot while it waits on you, red when broken, and for the last two the time at the row's end gives way to Waiting or Stopped, so the rungs that need the person are never told by colour alone. A paper's slot shows its reading (empty while unread, a half-filled ring while read) until its digest's mark takes it; a table, having no slot, puts the mark after the title. A New row's round plus sits in the same slot, so switching panels moves nothing.
- **Owlit's dot.** 8px, a plain `owlit-mark` fill: before a changed topic or line, in a tab's label, on Home's rows, in the status slot. In a row with a fill it sits inside the fill, in a wider left gutter, so the words still line up with the label above and the dot never straddles the fill's edge.
- **Group label.** 12px `muted-foreground`, regular weight, 4px over its rows, with the rows' side padding. Never a heading, never a count. A **fold** ("Sources · 4 docs", "5 changes", "Show 4 more") is a 13px muted text button with a chevron that turns when open.
- **Menu.** Floating material, 14px corners, 6px padding, items 32px with 8px corners and 10px side padding on the `accent` fill when highlighted. Words only; the chosen item has a muted check at the right, a state shows as a chip in the same slot; a submenu holds choices; groups are divided by a hairline, in the order what changes the thing, where it is, then Delete or Remove, in red, which fills solid red with white text when highlighted. A plain-text trigger ("Unread ▾", a Settings picker) is a ghost button in regular weight that fills while open.
- **Search button.** At the top of a list panel: a 36px button drawn like a field (`card`, a 70% border, magnifier, "Search", the ⌘K key) that opens the palette.
- **Find field.** 44px, 14px corners, `card`, a muted magnifier at the left, the "/" key or a clear button at the right, 15px text. One per list, and only once the list is longer than a screen.
- **Field.** 32px, 10px corners, the `input` border, no fill, no shadow; focus darkens the border, an error reddens it. Forms are one field per line, a small muted label above, an optional hint below, actions right-aligned with the primary last. A choice in a dialog is drawn as a Settings row (`FormRow`), never a checkbox beside a switch. A secondary form stays folded behind a text button and unfolds as a bordered `card` panel with a short title.
- **Buttons.** 32px with 10px corners and medium weight; small ones 28px, the smallest 24px, both with 8px corners and 13px or 12px text. **Primary** fills with `primary` and is the one filled button in a group; **outline** is the second choice beside it, so a dialog's Cancel is outline; **ghost** is everything else, muted text that darkens on hover; a destructive action is a ghost button in red or the last menu item, never a red fill. Icon buttons are square, ghost, muted, with their label in a tooltip. A **text button** inside a muted line (Retry, Undo, Show all) is muted, regular weight and 13px, 24px tall with 6px side padding, and takes the `muted` fill on hover and focus. An **inline link** is a few words inside a sentence that do something: the text's own ink with an underline at 30% that darkens on hover (`InlineLink`), never `mention` blue, which names things in the workspace.
- **Segmented control.** A `muted` box or pill with 2px padding (List / Table, System / Light / Dark); the chosen segment is lifted on `card` with the smallest shadow. A page switch is an **underline tab**: 14px medium at 60% that goes full on hover and carries a 2px underline when active. A filter is a **filter chip**: a 28px pill, 13px muted, with its count in 12px, that takes the `accent` fill when pressed. They never look alike. Controls with nothing to act on are hidden, not shown empty.
- **Chips.** *Status*: a 12px word on `muted` (or a red tint for an error), 8px corners, in a row's right slot. *Tag*: 24px, 8px corners, `muted`, a dot and the name, a remove square on hover. *Context*: 24px on `muted`, above an input, naming where a passage came from ("p. 4 · “…”"), with a cross to drop it. *Starter*: words on `secondary`, full, regular weight, no outline, no icon. *Attachment*: `card` with a hairline border and 14px corners, the file's icon or picture in a `muted` square, the name in medium and one muted 12px line; a problem turns the line red, a caution adds the `warning` triangle. A file owlit already has is never a chip; it is a mention.
- **Key.** A 20px chip: `muted`, 12px medium muted text, 6px corners. In a field or next to a row it loses its fill; in a tooltip it is translucent and follows the label.
- **Mention.** `mention` text with 0.3em corners and 0.2em side padding: a faint `mention` fill in an input so it reads as one token; plain in text, filling only on hover; the full title on hover. A paper still Unread in the Library is `mention` at 62% wherever it is named (a doc, a note, a chat), with "Unread" after the title on hover, so what only Owlit has read shows in its own writing; it turns full once the paper turns Reading. A wikilink to a doc that doesn't exist is muted with a dotted underline. The "@" popup is floating material: filter tabs, group labels, rows with a source icon.
- **Quoted passage.** One muted line behind a thin left rule: the words you sent with a message, a line's source on a connection, your last words on Home, a topic's summary.
- **Table.** Ruled, not boxed: a tinted header with rounded ends and medium text, a hairline under each body row, square cells, no frame, no column lines. Columns share the width by their content, none narrower than its longest word; a table too wide for its column scrolls sideways in place. The same in answers, docs and the Library.
- **Card.** `card` at 10px with a hairline border and no shadow; its border darkens on hover when the whole card is a link. A **row list** is rows with nothing around them and nothing between them (dialog choices, the agent choice, Shortcuts, Versions): each row is its own shape, a 10px `accent` fill on hover or focus, and the list reaches 8px past its column so the row's text lines up with the text around it; a choice's icon sits in a 32px `muted` tile. Never a box with dividers: it reads as one more frame around things that are already lined up. A **peek** is a row opened in place as a card at 14px with the small shadow, 6px of sheet above and below it: the row stays as the card's first line, where it was, its title whole and medium, underlined on hover since it leads into the paper; the row's mark slot and details give way, and under it the full details, the abstract, one line of controls ending in a filled primary. The card is one surface: its first line takes no fill of its own, and the row's star and ⋯ show while the card is hovered. In the table the row stays above its card, which does not repeat the title.
- **Composer.** The only lifted input: `card`, 14px corners, the small shadow; a 15px editor at least 56px tall, attached files above the text as chips, a footer with the round plus at the left and the pickers and round Send (Stop while working) at the right. Its pickers are 28px ghost text buttons with no chevrons, each with a tooltip saying what it holds. A one-line banner inside it is the only place it says something is wrong. The **ask bar** is the same material with the medium shadow: one 48px line floating over the page's bottom.
- **User bubble.** At the right, up to 80% wide, `secondary` fill, 14px corners, 15px text. Owlit's reply is plain Markdown at 15px with no bubble. Each message's actions hang below it as 24px ghost icon buttons, shown on hover, with the model and time in 12px muted.
- **Folding block.** Process that recedes (steps, agents handed work, a plan): one 14px line in `foreground` at 80% with a chevron, saying in a sentence what it holds; it shimmers while working. Opened, it is a bordered list at 10px of plain muted sentences, no kind icon, one muted detail at the right, and the ladder's marks for a waiting or broken row (a declined step says "Not allowed", muted, not red). Machine output opens under its row in a `muted` 13px box; a thought opens to muted 13px prose, no box. Neighbouring steps of one kind fold into one ("Read 3 files"). A plan is a ruled checklist with "done of total".
- **Result card.** What Owlit changed outside the chat, under its answer: a hairline border at 10px, 4px inside, 32px rows that sit tight with no dividers. Each row is a muted kind icon, the name, and one muted detail (an edit's "+N −M" with the additions in `owlit`). The whole row goes to the thing: hover gives it the `muted` fill and a go-to arrow (↗, not a chevron) in a slot kept at its end, and Undo before the detail. An undone row is muted and struck through, with Redo where Undo was.
- **Waiting card.** What waits on you sits above the composer, not among the messages: `card` with the composer's border, radius and shadow, a step less roomy, no icon (the words say what waits). A permission is what Owlit wants in medium weight, a muted summary, a preview in a bordered box cut with a fade, then its buttons, Allow primary. A question is a 12px muted header, the question in body medium and its choices as blocks on the `muted` fill, the pick lifted onto `card` as a chosen segment is, each with its number key; a pick never sends by itself. It folds to one line and is never dismissed. One decision never shows two sets of buttons.
- **Broken block.** A reply that broke is a bordered block in the result card's frame, never a wrapping line: a red × and "Owlit stopped" with Details, Dismiss and Retry as text buttons on that line, then why, in owlit's words, muted, under it. The agent's own words are behind Details, in a `muted` monospace box. A reply you stopped keeps its partial answer with "Stopped, partial" under it, muted.
- **Owlit's edit.** The same in a doc, a note, a step and a preview: new words in `owlit` with a 1px underline, removed words muted with a 1.5px strike in `owlit` (different in shape as well as tone), a 2px `owlit` rule down the left of every touched line, "Suggested by Owlit" in 13px muted with Discard (ghost) and Apply (filled, 28px). Removal is never red.
- **Owlit's note.** A 2px underline in `owlit-mark` under exactly the words it is about, below and thicker than a link's; no icon, no margin, no column. Open, the words take an `owlit-mark` wash and the note pushes the text down as a `card` with a hairline border and a 3px `owlit-mark` rule at its left: who and when in 12px muted, the note in 14px Markdown, its actions as text buttons at the bottom right.
- **Reader's comment.** Owlit's note in a person's ink: a 2px `person-mark` underline, a `person-wash` while open, and the same card with a `person-mark` rule (one shape in code, `side-card.ts`, so the two can't drift). Its entries are "name · when" in 12px muted over their words, divided by hairlines.
- **Selection menu.** Over a selection in a doc, a note or a digest, one 24px "Ask Owlit" row in the floating material, 8px off the selection, covering as little text as it can.
- **Reader.** Pages on the well, each white with a hairline `pdf-page-edge` (under a 12% black shade in the dark theme, unless turned off), fit to width. Nothing sits above the document: its controls are **floating pills** (32px, full radius, 12px muted text, 24px round items) at the page's edges. Highlights tint the page with multiply and deepen one step under the pointer; nothing else marks them. A passage pointed at from elsewhere gets a 2px `pdf-link` ring that pulses twice and goes. **Read wear**, for looking, never counted: a sentence Owlit's answer cited has a 2px `pdf-owlit` bar in the margin 7px left of its lines (70%, full under the pointer), which rings the sentence on hover, names the chat and day in its tooltip and goes back to the answer on click; the pages the person stayed on darken a 3px strip down the reader's right edge, one segment a page, `foreground` from 12% to 60% over five minutes, with Owlit's `owlit-mark` tick on pages it cited. A paper nobody has read shows no strip.
- **Highlight toolbar.** Beside a selection or a highlight, in the floating material at 14px: four 18px colour dots with a check on the current one (in `pdf-ink`, since the page is white), a divider, then 28px ghost icon buttons with tooltips, the feather for Ask Owlit.
- **Highlights list.** Under group labels by page: each a 3px bar in its `-mark` colour, up to four lines of 14px text, the comment under it, "Added by Owlit" when it was; the active one takes `accent`.
- **Digest.** Owlit's digest of a paper, in place of the PDF: on the sheet in the reading column, one 13px muted line that signs it ("Digest · Owlit, 2 min ago"), then Markdown at 15px. Selected text takes the selection menu, never a highlight. While it is written, one muted shimmering sentence holds its place; no spinner, no card. Its figures sit on white in a hairline box at 10px, their label in 13px muted under them.
- **Speaker column.** A Knowledge line anywhere: the speaker as a verb phrase in a 112px column (name medium, verb muted, 13px), the sentence in 15px, then in 13px muted its sources as mentions and its condition as a sentence. A line fills lightly on hover and when open, when its history rules off under it with dates in a narrow column.
- **Drop card and empty place.** Where something can be added and nothing is: a dashed box (1.5px at 15%, 18px corners) with a 15px medium line, one muted sentence, one or two small buttons (primary first); a file dragged over the page draws a dashed overlay inside the sheet. An empty place is the same two lines centred in a narrow column, in the dashed card when there is a way to start, with at most one 13px line under it. A missing thing says so the same way with a "Back to …" outline button. No illustration, nothing to dismiss.
- **Tour.** A spotlight on one part of the real page, a rounded hole in a dim ringed in white, and beside it a card in the floating material: a 12px muted kicker, a 15px semibold title, a 14px muted body, step dots, Skip tour and a small primary Next.
- **Tooltip.** The label, then the shortcut as a key chip; 12px on the inverted material with an arrow. An **info icon** is a 20px round target around a 14px muted icon, its tooltip below and at most 288px wide; a dialog's title carries one instead of a description.
- **Toast.** Bottom right, floating material at 10px: the message, a muted description, an Undo or Open action. It moves left of a docked agent panel.
- **Settings row.** At least 56px, flush with the group's heading, a hairline between rows and none around them: the name with an optional info icon at the left, the control at the right, centred on the name and its help together. A second 13px line only for a problem (red), an open form, or help without which the choice can't be made; everything else sits behind the info icon. Controls end on one right edge; text buttons that come last pull out by their own padding so their text lines up with a switch; hover-only actions sit left of what always shows. A key shows as "••••ab12" in monospace; an `owlit` check sits in the control's slot once a service accepted a value, so the row keeps its height. Work a row does itself (an agent being set up) is muted text and a text button in the control's slot.

## Do's and Don'ts

Do:

- Reach for tone before lines, and words before icons.
- Put the fix next to the problem.
- Keep a concept's look identical everywhere, and change the component when it must change.
- Check contrast on hover and selection fills, not just the bare surface.

Don't:

- Mark a healthy state with a dot, a label or "Connected"; the status slot's faint ring is the one exception.
- Tell two states apart by a shade of one hue, or use red for anything the person chose.
- Put a shield or a triangle beside words that already say something waits.
- Count, group or badge what Owlit did; Owlit's green dot is the whole mark, and nothing Owlit wrote carries an accept, confirm or triage control.
- Show an agent's or a library's words as the answer or the error; quote them as a detail.
- Put icons before every menu item, ticks after finished steps, spinners where a fill will do, or coloured cards around process.
- Name a step by its command line or a tool's internal name, or put a decision's buttons in the middle of the messages.
- Use two lines where a title plus an inline muted detail fits, or show reading progress in a list.
- Use raw Tailwind palette colours, opaque grey fills, opacity on readable text, focus rings on fields, Dosis outside the wordmark's places, or sizes outside 22, 18, 15, 14, 13 and 12px (and the few 16px places under Typography).
- Box a table, outline a chip beside a bordered surface, override a menu's padding or radius in one place, or squeeze several inputs onto one line.
- Write a description under a dialog title, a label on a self-explanatory icon, or leave a secondary form open.
- Slide a panel, animate a list, or ask "Are you sure?" where Undo will do.
- Hide the one thing the person needs (a fix, a full title) behind a tooltip.
- Write into this file what a control does, when a state changes, or a number that holds in one place; keep it in that place's code, with its reason.
