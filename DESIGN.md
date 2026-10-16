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
  # A comment on a doc's words, whoever wrote it; under 3:1, so only ever the line under words (index.css)
  comment-mark: "oklch(0.74 0.155 80)"
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
    textColor: "{colors.foreground}"
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
  comment-underline:
    textColor: "{colors.comment-mark}"
  comment-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  doc-highlight:
    backgroundColor: "{colors.text-highlight}"
  selection-menu:
    backgroundColor: "{colors.popover}"
    typography: "{typography.secondary}"
    rounded: "{rounded.md}"
  empty-box:
    rounded: "{rounded.xl}"
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

owlit's visual system: the tokens above, mirrored in `app/src/index.css` (the source of truth), and the rules that hold in more than one place. It says how things look; what a control does is in its code, and a value that holds in one place lives there too. Shared shapes are components in `app/src/components/` on the shadcn primitives in `components/ui/`: change the component, then this file, never one call site.

## Overview

### Five rules

1. **Paper, not steel.** Every neutral carries a faint warm tint, so greys read as paper and text reads as ink. Surfaces are opaque and step lighter from the back of the window to the front: frame, panel, sheet, card, popover. The brightest thing on a screen is what you read or act on. Depth is told by that lightness, then a hairline, and only what floats gets a shadow.
2. **Quiet by default.** A row at rest is its name and one line of muted detail. Actions appear on hover, focus or an open menu. Nothing is counted in a badge; a count that earns its place is a muted number at the end of a line. A finished thing goes quiet.
3. **One ladder of states, one mark per rung.** Everything that can have a state uses the same marks: *fine* is nothing at all; *working* is a quiet grey (a breathing ring, a shimmer on the words, a muted spinner); *changed since you last looked*, only for what Owlit did, is Owlit's dot, gone once seen; *waiting on you* is the `warning` dot; *broken* is `destructive` red. A row that waits or is broken also says so in words (Waiting, Stopped), so the rungs that need the person never rest on colour alone. Each rung is its own hue. A shade may say how much, never which: an unread paper's mention at 62% and Owlit's two greens are one meaning at two strengths.
4. **Every colour says one thing.** Neutrals carry the whole interface. Each other colour has a single meaning and draws marks (words, dots, rules, underlines), never washes. Paper tones never touch a mark. Two states that both matter are never told apart by colour alone.
5. **Three voices stay apart.** What you wrote, what a paper says and what Owlit thinks are drawn differently and signed. Everything Owlit's hand changes on your things is one green (`owlit`, and `owlit-mark` for its dots), signed "Owlit". The agent underneath is named only where it is picked, and its own output is quoted as a detail, in monospace, never as the answer. A comment is a remark beside the words, not a change to them, so it has its own colour (`comment-mark`) whoever made it, and each entry is signed in ink, Owlit's too.

### Habits

- **Sentences, not labels.** Short plain English: "Owlit wants to edit untitled.md", "Read 3 files". Headings are one or two words in sentence case. Counts read as words ("3 comments", "2 of 3"); a large one in a narrow cell is short in the language's way ("2.7K", "3.2万"). Recent times are relative ("2 h ago"), older ones short dates; a clock time stands alone only for today. An ellipsis marks a continuing action ("Checking…", "Manage agents…").
- **Words for what is Owlit's, icons for what is everyone's.** An action is an icon alone only when people know the icon from other apps (back, close, ⋯, star, copy, send, search, a panel toggle) or it is the feather, when it repeats or room is short, and when a wrong guess costs nothing: someone who never hovered over it guesses right. Everything else is words: what only Owlit does (Find more papers), what sets Owlit working or leaves the app, a page's or dialog's main action, and anything with a count or a state ("2 comments"). In a row that holds both, the Owlit action leads in words. Menu items are words only; a list's create action (New chat) is the one word-and-icon pair. An icon-only action keeps its label and shortcut in a tooltip. An explanation sits behind an info icon, unless a setting can't be chosen well without it; then it is one muted line under its name.
- **One line per thing.** A row is a title, one muted detail inline, one detail at the right end. It earns a second line only for a problem, which then holds the fix, or for words the person typed.
- **Same thing, same look.** A row, a ⋯ menu, a find field, a card, an empty state, a mention look the same in every place, and a right-click opens the same menu as the row's ⋯. A new feature copies the nearest existing shape before inventing one; when a shape must change, it changes everywhere.
- **Process folds, results lead.** What the agent did is a quiet, foldable list; the answer is full-width body text.
- **Undo, not confirm.** Deleting, removing and dismissing happen at once and leave a toast with Undo. Nothing asks "Are you sure?".

### Vocabulary

**Owlit** is the assistant; everything it says, edits or leaves is signed Owlit. **Ask Owlit** is the one name for sending a passage or question to it (the feather in icon rows). **Agent** is the local coding agent underneath (Claude Code, Codex, Gemini CLI, a custom command), and the agents it hands work to; **connector** is reserved for data sources and MCP servers. **Steps** are one answer's thoughts and tool calls. The **agent window** is the app-wide place to talk to Owlit: the **ask bar** at the bottom of a page, and the **panel** docked beside it. A **thread** is papers Owlit gathered for a question, with an **answer** from each; its **memo** is Owlit's reading of them. **What Owlit keeps in mind** is its memory of you, a short list in your words; what owlit records of what you do is never called memory. The **places** are Home, Chat, Docs, Threads and Library.

### Brand

The mark is a feather: one hand-drawn, round-ended line that curls back on itself three times. In the interface it is in the text's own ink, never filled, outlined, shadowed or tinted, and drawn to lucide's measure (`OwlitMark`) so it sits among lucide icons as one of them. It stands only for Owlit (the agent window's toggle, Ask Owlit, the app icon), never for decoration.

The wordmark is lowercase "owlit" in Dosis 500 slanted 12° (a skew, since Dosis has no italic). The lockup (`OwlitLockup`) puts the feather before the word as outlined paths, and appears only on the first launch and the welcome page. Its i's dot is `owlit-mark`, Owlit's mark on its own name. Elsewhere in the interface the name is plain text.

The app icon is the one place the brand wears Owlit's green, because it lives outside the app: a warm-white feather on a forest-green tile, with two lighter bars under its lower curls like a highlighted passage, one icon for light and dark Docks. Owlit Dev wears the same drawing on a graphite tile, so a preview never passes for the real app. `apps/desktop/scripts/icon.mjs` builds every size.

## Colors

Every colour is a semantic token; feature code never touches the raw palette.

State fills (`muted`, `secondary`, `accent`, `sidebar-accent`) are translucent tints of the text colour, so a hover on any surface, or a chip on a hovered row, is always one visible step.

| Layer | Token |
|---|---|
| Frame: top bar, icon rail, the window behind the sheet | `sidebar` |
| Panels: list panel, docked agent panel, the reader's well | `sidebar-panel` |
| Sheet | `background` |
| Raised: composer, find fields, cards, the active rail button | `card` |
| Floating: menus, pills, dialogs, toasts | `popover` |

Dark mode keeps the tint and the steps, lifted off black, and lightens the marks. The **paper tones** swap the whole neutral family and keep Warm's lightness steps. There is no accent colour to pick: filled buttons are the tone's near-black (`primary`).

**Marks.** One meaning each, in both themes, deep enough to carry it alone (3:1 on every fill it sits on) unless the table says otherwise:

| Token | Means |
|---|---|
| `warning` | Waits on you, and nothing else |
| `destructive` | Broken, or an action that removes. A removal Owlit proposes, a step you declined and a reply you stopped are not errors and get no red |
| `owlit` | Owlit's hand at text strength: words it proposes, the strike and rule beside them, a check on a value a service accepted |
| `owlit-mark` | Owlit's hand at mark strength: its dot, a tick on a page it cited. A step lighter than `owlit` and still 3:1, so it needs no rim |
| `mention` | A thing in the workspace named in text (paper, doc, thread, chat), and what points at a passage in a PDF |
| `text-highlight` | Your `==highlight==` in a doc, the same lemon as a yellow PDF highlight |
| `comment-mark` | A comment on a doc's words, whoever wrote it |
| `tag-*` | One low-chroma hue per tag, by its name; only ever a small dot before the name |

`comment-mark` is under 3:1 on paper, so it never stands alone: it is only ever a line under words or a bar beside a card, never a dot or a fill of its own, which keeps it from passing for `warning` or a highlight. Its wash (`comment-wash`) is a faint tint behind the words while their comment is open or pointed at, well short of a highlight.

**PDF colours don't follow the theme**, since a page is white in both: they are fixed and drawn with multiply so the ink stays black, and the `-mark` twins are deep enough for a bar or a dot off the page. The highlight colours have no meanings; the reader decides.

**Contrast.** Readable text is AA (4.5:1) on every surface it can sit on, hover and selection included. Secondary text is `muted-foreground` at full strength, never faded further; the one sanctioned middle is `foreground` at 80%, for a line that leads a folded block and the model's name in the picker. To calm a colour, lower its chroma; don't add `muted-*` twins. Opacity is for fills (`bg-destructive/10`), not for text.

## Typography

One face, seven sizes, two weights. **Figtree** everywhere, at the sizes in the front matter: `text-title` (22px) for page titles and a doc's first line; 18px for a paper's title in its panel and a doc's `#` and `##`; `text-base` (16px) for a dialog's section title, the palette's input, a doc's `###` and deeper, and the first launch's sentences; `text-body` (15px) wherever people read and write; 14px for the interface; `text-detail` (13px) for secondary text; 12px for captions. Weight carries hierarchy before size or colour: regular for text, medium for titles, the active item, button labels and a speaker's name; semibold only for headings in a doc or an answer and for bold, so a doc's first line outweighs the headings under it. Numbers that line up are tabular; long titles are balanced; truncation ends in an ellipsis and the full text shows on hover.

Chinese, which Figtree doesn't have, comes from **PingFang SC** (Microsoft YaHei on Windows) at the same sizes and weights, while Latin letters and digits in the line stay Figtree; the page's `lang` follows the interface language. Translated labels get the room their words need rather than the English width.

**Dosis** is the wordmark's face, used only for the Chat greeting and the first launch's titles; it tires at small sizes. Chinese in it stands upright. **Monospace** is for what a machine said or takes: commands, keys, paths, an agent's raw message. A sentence about them is never monospace.

Rendered Markdown (answers, digests, notes) wraps long code lines rather than scrolling, and its tables are ruled like every table.

## Layout

The window is a frame (top bar and icon rail) holding one sheet. The rail lists the places, Settings alone at the bottom; the top bar's right end holds the feather that docks the agent window.

- **The sheet** splits by half-pixel hairlines into the list panel (Chat and Docs only), the page, and the docked agent panel when open. Panels show and hide at once, never sliding, and the list panel folds while the agent panel is open so the page keeps its column. On a paper, the details panel and the agent panel share one slot at the right.
- **One reading column** for reading and writing, centred. Library is the one wide page, in every tab and layout, so switching never moves its header. A page of rows alone stays in the reading column, so a line never runs the width of the window. A table may reach into the wide column below words that stay in the reading one.
- **Pages scroll whole**, header included. A paper, a doc and a thread open under the page header: a muted breadcrumb at the left that starts at the sheet's edge and ends at the page itself, ghost icon buttons at the right.
- **Rows keep a gap**, so two filled neighbours never merge; lists that run long or sit tight (the docs tree, menus, result cards) use the shorter row, and menu rows touch. Grouped lists keep one ladder: a small step from a label to its rows, a larger one between groups, larger again between sections. Dividers stop at the text edges.
- **Scrollbars** are the Mac's own overlay bars in the theme's scheme; elsewhere, a thin pill of the text colour with no trough or arrows.
- **The reader's page** (`apps/share-web`), what a shared doc's link opens in any browser, uses the same tokens and shapes, drawn by hand since it has none of owlit's components.

## Elevation & Depth

Tone first, then a hairline, then a shadow, and only what floats or is acted on gets one. Three materials; each component below names its own.

- **Sheet.** Content sits directly on the background with at most a hairline border and no fill. Content never casts a shadow.
- **Card.** `card` with a hairline border and the small shadow.
- **Floating.** `popover`, a faint ring of the foreground and the large shadow, one utility in code (`menu-surface`); corners and text colour stay with each shape. Dialogs are the same material over a lightly blurred dim. Tooltips invert: foreground fill, background text.

**Focus** marks appear only after keyboard navigation (Tab, arrows, Esc), never after a pointer press or typing in a field. Buttons and tabs take a ring of `ring`; rows and text buttons take their hover fill; fields darken their border however focus arrived, never a ring, and an error reddens it.

**Motion** explains a change and never decorates. What changes size or place in front of the person moves there, so the eye can follow (`--t-layout`): a block that opens grows from its line and pushes what is below it. A mark on the ladder fills in or leaves rather than popping (`--t-mark`); Owlit's dot is the one slower exit, so the person catches it going. What the person summoned appears at once: panels and page switches never slide; menus, popovers and dialogs fade and scale in quickly (`--t-menu`). Every move shares one easing (`--ease`). A theme or tone switch changes every colour in one frame. "Alive" is a breathing ring or a shimmer on an in-progress sentence; a spinner waits before it shows, so a fast load never flashes one. Words never fade in. Reduced motion stops the breathing and every move of size or place and keeps only the fades.

The first launch is the one place where motion is the content, and even there it shows real gestures with the real parts at a small scale, never a mascot or confetti. Reduced motion shows each animation's last frame, still.

## Shapes

The front matter's `rounded` scale, by role: `lg` is the base (the sheet, cards, a row's hover fill, default buttons, fields, code blocks); `xl` for what floats, is typed into or is dropped onto (the composer, find fields, menus, dialogs, a peek, the dashed drop card); `md` for what sits inside those (rows, menu items, chips, small buttons); `sm` for the smallest (keys); `full` for pills and dots. Nested corners are concentric (outer radius = inner + padding), and a larger shape inside a smaller one takes the larger radius rather than stacking two alike.

Lines are one hairline in `border`, translucent in dark mode; half-pixel lines divide the panels from the sheet. A resize edge (`PanelResizeHandle`) is invisible until hovered.

## Components

The shared shapes. A place uses each as it is; measures are in the front matter and the code.

**Rows and lists**

- **Row** (`ListRow`, `list-row.tsx`). Title, one muted detail inline, one at the right. `muted` on hover, `accent` while selected or its menu is open, `sidebar-accent` in the rail and panels; keyboard focus takes the hover fill. A row never fills with a colour of its own.
- **Row actions** (`RowMenuButton`, `action-menu.tsx`). A ⋯ at the row's end, shown on hover, focus or while open. Nothing in the row moves when it shows, and a status word is never covered. A right-click opens the same menu. Renaming (`RenameInput`) happens in the row's own shape.
- **Status slot** (`StatusRing`, `status-ring.tsx`). Every row in a list that can have a state keeps it, so a state fills in without moving anything; it shows rule 3's marks (`marks.tsx`). At rest it is empty, keeping its width so titles line up. A paper's slot shows its reading (`ReadingRing`); a table, having no slot, puts the mark after the title. A New row's plus (`NewRow`) sits in the same slot.
- **Owlit's dot** (`NoteDot`). Rule 3's *changed* rung. In a row with a fill it sits inside the fill, never straddling its edge.
- **Group label** (`GroupLabel`). Caption-size muted text over its rows: never a heading, never a count. A **fold** (`FoldButton`) is a muted text button with a chevron that turns when open.
- **Row list** (`RowList`). Rows with nothing around or between them, for short lists and a dialog's choices. Never a box with dividers.
- **Table** (`ruled-table.tsx`). Ruled, not boxed: a tinted header, a hairline under each row, no frame, no column lines. No column is narrower than its longest word; a wide table scrolls sideways in place, never the page.
- **Peek** (`PaperPeek`, `tablePeekCard`). A row opened in place as a card, the row staying as its first line, where it was. The card is one surface.

**Floating things**

- **Menu** (`ui/dropdown-menu.tsx`, `ChoiceMenu`). Floating material, words only; the chosen item has a muted check at the right. Groups are divided by a hairline: what changes the thing, where it is, then Delete or Remove in red, last. A plain-text trigger ("Unread ▾") is a regular-weight ghost button.
- **Selection menu** (`useSelectionMenu`, `SelectionMenuItems`). Over selected text: "Ask Owlit" in words, then the tools as icons, in the highlight toolbar's order. A new tool joins as an icon.
- **Tooltip** (`Tip`). The label, then the shortcut as a key. An **info icon** (`Info`) holds an explanation; a dialog's title carries one (`DialogHeading`) instead of a description.
- **Toast** (`ui/sonner.tsx`). Bottom right: the message, a muted description, an Undo or Open action.
- **Mention** (`MentionToken`, `mention/`). `mention` text, with a faint fill in an input so it reads as one token. An unread paper is named at 62%. A link to a doc that doesn't exist is muted with a dotted underline.

**Inputs and controls**

- **Find field** (`FindField`). One per list, and only once the list is longer than a screen.
- **Field** (`ui/input.tsx`). The `input` border, no fill, no shadow. Forms are one field per line, a muted label above, actions right-aligned with the primary last. A secondary form stays folded behind a text button.
- **Settings row** (`FormRow`). The name at the left, the control at the right, a hairline between rows and none around them; controls end on one right edge. A second line only for a problem, an open form, or help the choice needs. A choice in a dialog is a Settings row, never a checkbox beside a switch. Groups are parted by space, never a box.
- **Buttons** (`ui/button.tsx`, `IconButton`). **Primary** is the one filled button in a group, its key inside after the label when a key presses it; **outline** is the second choice beside it (a dialog's Cancel); **ghost** is everything else. A destructive action is a red ghost button or the last menu item, never a red fill. A **text button** in a muted line (Retry, Undo) is muted and regular weight. An **inline link** (`InlineLink`) is words in a sentence that do something, in the text's own ink, never `mention` blue.
- **Segmented control** (`SegmentedControl`), **underline tab** (`ui/tabs.tsx`) and **filter chip**: a choice of view, a page switch, a filter. They never look alike. A control with nothing to act on is hidden.
- **Chips.** *Status* (a word in a row's right slot), *tag* (a dot and the name), *context* (where a passage came from, above an input), *starter* (words on `secondary`, no icon) and *attachment* (`ui/attachment.tsx`, a file on `card`). A file owlit already has is a mention, never a chip.
- **Key** (`ui/kbd.tsx`). A `muted` chip; no fill in a field or beside a row.

**Owlit's work**

- **Composer** (`ComposerDock`). The only lifted input; its pickers are ghost text buttons with no chevrons, and a banner inside it is the only place it says something is wrong. The **ask bar** (`AgentAskBar`) is the same material.
- **User bubble** (`ui/bubble.tsx`). Yours, at the right on `secondary`. Owlit's reply is plain Markdown with no bubble.
- **Folding block** (`FoldingBlock`). Process that recedes (steps, a plan): one line at `foreground` 80% saying in a sentence what it holds; opened, plain muted sentences with no kind icons. Machine output opens in a `muted` monospace box. Neighbouring steps of one kind fold into one ("Read 3 files").
- **Result card** (`ResultCard`). What Owlit changed outside the chat, under its answer, one row per thing; a row goes to its thing (↗, not a chevron) and has Undo.
- **Broken block.** A reply that broke is a bordered block in the result card's frame, never a wrapping line, with the agent's own words behind Details.
- **Waiting card** (`WaitingDock`). What waits on you sits above the composer, never among the messages. One decision never shows two sets of buttons.
- **Owlit's edit** (`.suggest-*`, `index.css`). The same in a doc, a note, a step and a preview: new words in `owlit` underlined, removed words muted under an `owlit` strike, an `owlit` rule beside every touched line. Removal is never red.
- **Owlit's runs** (`runs/`). Background work shows where it happens, never in a list of its own, as rule 3's *working* rung and one sentence in Owlit's voice naming what and where. A run waiting its turn shows a hollow ring.
- **Comment** (`docs/comments/`). Everyone's comments are one shape: a `comment-mark` underline under exactly the words, below and thicker than a link's, and a card beside the reading column. The share page draws the same card.

**Pages**

- **Card.** `card` with a hairline border and no shadow; the border darkens on hover when the whole card is a link.
- **Quoted passage** (`Quote`). Muted words behind a thin rule, for words quoted from elsewhere.
- **Drop card and empty place** (`DropCard`, `EmptyPlace`, `NotFound`). A dashed box, or nothing around, with one medium line, one muted sentence and at most two small buttons. No illustration, nothing to dismiss.
- **Reader.** Nothing sits above the document: its controls are floating pills at the page's edges. Highlights tint the page and nothing else marks them.

## Do's and Don'ts

Do:

- Reach for tone before lines, and for words wherever an icon would need its tooltip to be understood.
- Put the fix next to the problem.
- Keep a concept's look identical everywhere, and change the component when it must change.
- Check contrast on hover and selection fills, not just the bare surface.

Don't:

- Mark a healthy state with a dot, a ring, a label or "Connected" (rule 3).
- Tell two states apart by a shade of one hue (rule 3), or use red for anything the person chose.
- Put a shield or a triangle beside words that already say something waits.
- Count, group or badge what Owlit did; its dot is the whole mark, and nothing Owlit wrote carries an accept, confirm or triage control.
- Show an agent's or a library's words as the answer or the error; quote them as a detail.
- Put icons before every menu item, ticks after finished steps, spinners where a fill will do, or coloured cards around process.
- Name a step by its command line or a tool's internal name, or put a decision's buttons in the middle of the messages.
- Use two lines where a title plus an inline muted detail fits, or show reading progress in a list.
- Use raw Tailwind palette colours, opaque grey fills, opacity on readable text, focus rings on fields, Dosis outside the wordmark's places, or sizes outside 22, 18, 16, 15, 14, 13 and 12px.
- Box a table, outline a chip beside a bordered surface, override a menu's padding or radius in one place, or squeeze several inputs onto one line.
- Write a description under a dialog title, a label on a self-explanatory icon, or leave a secondary form open.
- Slide a panel or animate a list.
- Hide the one thing the person needs (a fix, a full title) behind a tooltip.
- Write into this file what a control does, when a state changes, or a number that holds in one place; keep it in that place's code, with its reason.
