---
version: alpha
name: owlit
description: A quiet desk for reading and thinking. Warm paper tones and an interface that steps back so papers, notes and answers stay in front.
colors:
  # Light mode. Dark values are in the Colors section; app/src/index.css is the source of truth.
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
  # Accents
  mention: "oklch(0.48 0.09 255)"
  warning: "oklch(0.66 0.12 70)"
  destructive: "oklch(0.55 0.16 25)"
  success: "oklch(0.56 0.1 155)"
  # Marks that carry meaning: the star, and eight tag hues
  star: "oklch(0.76 0.13 75)"
  tag-red: "oklch(0.64 0.11 28)"
  tag-orange: "oklch(0.7 0.11 55)"
  tag-amber: "oklch(0.76 0.11 85)"
  tag-green: "oklch(0.66 0.09 145)"
  tag-teal: "oklch(0.66 0.07 195)"
  tag-blue: "oklch(0.62 0.09 250)"
  tag-violet: "oklch(0.6 0.1 295)"
  tag-pink: "oklch(0.68 0.1 350)"
  # PDF marks: the page is white in both themes, so these never flip
  highlight-yellow: "oklch(0.93 0.11 98)"
  highlight-green: "oklch(0.91 0.08 150)"
  highlight-blue: "oklch(0.9 0.055 240)"
  highlight-pink: "oklch(0.9 0.065 355)"
  highlight-yellow-mark: "oklch(0.82 0.15 92)"
  highlight-green-mark: "oklch(0.72 0.13 150)"
  highlight-blue-mark: "oklch(0.68 0.1 245)"
  highlight-pink-mark: "oklch(0.7 0.13 355)"
  pdf-selection: "oklch(0.86 0.06 255)"
typography:
  display:
    fontFamily: Instrument Serif
    fontSize: 44px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.025em
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
  body:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.625
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
  rail-button: 32px
  menu-row: 32px
  list-row: 36px
  gutter: 16px
  column: 768px
components:
  frame:
    backgroundColor: "{colors.sidebar}"
  main-sheet:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
  list-panel:
    backgroundColor: "{colors.sidebar-panel}"
  list-row:
    textColor: "{colors.foreground}"
    typography: "{typography.ui}"
    height: "{spacing.list-row}"
    rounded: "{rounded.md}"
  list-row-hover:
    backgroundColor: "{colors.sidebar-accent}"
  list-group-label:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
  composer:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  composer-picker:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    rounded: "{rounded.md}"
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
  text-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
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
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.md}"
  user-bubble:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  mention:
    textColor: "{colors.mention}"
  permission-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  permission-shield:
    textColor: "{colors.warning}"
  step-failed:
    textColor: "{colors.destructive}"
  code-block:
    backgroundColor: "{colors.muted}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  floating-button:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
  page-title:
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
  find-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
  filter-chip:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.secondary}"
    rounded: "{rounded.full}"
  filter-chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  peek:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
  paper-heading:
    textColor: "{colors.foreground}"
    typography: "{typography.heading}"
  star-mark:
    textColor: "{colors.star}"
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
  reader-well:
    backgroundColor: "{colors.sidebar-panel}"
  reader-pill:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  highlight-popover:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
  pdf-selection:
    backgroundColor: "{colors.pdf-selection}"
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
  command-palette:
    backgroundColor: "{colors.popover}"
    rounded: "{rounded.xl}"
---

# owlit design

owlit should feel like a quiet desk for reading and thinking: warm paper tones, generous room, and an interface that steps back so papers, notes and answers stay in front. Nothing should compete with the content for attention unless something needs the user.

**How to use this file.** Read it before changing any interface, and update it in the same change whenever a style decision changes. The front matter holds the tokens. The sections below say why they're set that way and how to apply them. Live values are in `app/src/index.css`, and shared component styling is in `app/src/components/ui/`. When a token changes, change the CSS and this file together. When a rule changes for a component, change the shared component, not each place that uses it. Check the file with `npx @google/design.md lint DESIGN.md`: it should report no errors. Expect contrast warnings on the translucent fills (the linter ignores their alpha), and orphan warnings for `border`, `input` and `success`, which the format can't attach to a component.

## Overview

### Principles

- **Silent when fine, clear when not.** A working state has no badge, dot or label. Only states that need the user speak: an agent that isn't installed, a pending permission, an error. When they speak, it's one small, specific line or card, not a colour wash.
- **Red means broken.** Destructive colour is for errors and irreversible actions only. Something the user chose, such as rejecting an edit, is shown in the muted tone like any other finished step.
- **One thing, one look.** A concept is drawn the same way everywhere it appears. A mentioned paper looks identical in the composer, in the user's message and in the assistant's reply. Every menu shares the same geometry.
- **One name, one thing.** A label names what it opens. A menu item that opens "Local agents" says "Manage agents…".
- **Depth from tone, not lines.** Layers are told apart by small steps of background lightness. Borders are thin and light, and shadows are soft and rare. Avoid stacking outlines.
- **Fewer marks.** Text before icons. Menu items are words only. Status icons, kind icons and decorative glyphs appear only where they help scan a long list. A finished step needs no tick: it goes quiet.
- **Room to breathe.** Rows are tall enough to read without effort, and titles get the full width of their row and popover. Secondary details sit inline in a lighter tone rather than stacked on a second line.
- **Words on demand.** Show what someone needs to act; keep the rest one hover or click away. A self-explanatory action is an icon with its label in a tooltip. An explanation sits behind an info icon. A secondary form stays folded behind a single text button until asked for. A row earns a second line only for a problem, or for something the user typed. When it's a problem, that line shows the fix.
- **Process recedes, results lead.** The agent's thinking, tool calls and plans are quiet, ruled lists that fold away. The answer is full-width body text.

### Vocabulary

- **Agent**: a local coding agent owlit drives over the Agent Client Protocol (Claude Code, Codex, Gemini CLI, or a custom command).
- **Connector**: reserved for data sources and MCP servers. Don't use it for agents.
- **Steps**: the agent's thoughts and tool calls for one answer, shown as one foldable block.
- **Agent window**: the app-wide panel for talking to an agent without leaving the page. Its conversations are ordinary chats.

## Colors

Neutrals carry a faint warm tint (hue 60 to 85, chroma under 0.012), so greys read as paper rather than steel. Every colour is a semantic token; feature code never uses raw palette colours. The app follows the system light or dark setting.

There are two kinds of colour:

- **Surfaces are opaque** and get lighter from back to front. Whatever sits further forward, or is meant to be used, is brighter.
- **State fills are translucent** tints of the text colour: `muted`, `secondary`, `accent` and `sidebar-accent`. Hover, selection, chips and code blocks use them. They tint whatever is beneath them, so a chip on a hovered row, or a hover on any surface, is always one visible step darker (lighter in dark mode). Never use an opaque grey for a state; two opaque greys will eventually collide.

Surfaces, back to front (OKLCH lightness):

| Layer | Token | Light | Dark |
|---|---|---|---|
| Frame: top bar and icon rail | `sidebar` | 0.942 | 0.155 |
| List panel | `sidebar-panel` | 0.976 | 0.19 |
| Main sheet | `background` | 0.99 | 0.215 |
| Raised: composer, inputs, cards, selected rail icon | `card` | 1.0 | 0.245 |
| Floating: menus, dialogs, floating buttons | `popover` | 1.0 | 0.255 |

Text and accents in dark mode: `foreground` 0.935, `muted-foreground` 0.7, `mention` `oklch(0.78 0.07 255)`, `warning` `oklch(0.78 0.11 75)`, `destructive` `oklch(0.68 0.13 22)`, `star` `oklch(0.8 0.12 80)`; tag hues lift to lightness 0.7 to 0.8 with slightly lower chroma. State fills become 7 to 8% tints of near-white, and borders become 10% white.

The composer is the brightest thing in the main sheet, with a soft shadow. It's the place the user acts on most, so it is lifted rather than coloured.

Accent colours are low in chroma and used sparingly:

| Token | Role |
|---|---|
| `mention` | References to workspace items: papers, docs, knowledge |
| `warning` | Something waits on the user, such as a permission request or an agent that can't run |
| `destructive` | Errors and irreversible actions, never a user's own choice |
| `success` | Use rarely; completion is usually shown by quieting a row |

Marks that carry meaning, never fills or washes:

| Token | Role |
|---|---|
| `star` | A starred paper: the small filled star after its title, and the active star toggle |
| `tag-*` | Eight low-chroma hues. Each tag gets one, picked from its name so it is the same everywhere, shown only as a small dot beside the tag's name |

PDF marks are the one place colour does not follow the theme. A rendered page is white in both themes, so the four highlight colours (`highlight-yellow`, `-green`, `-blue`, `-pink`) and the text selection colour (`pdf-selection`) are set once and never flip. Highlights are drawn with multiply, so they tint the page like a marker and the glyphs under them stay black. Each colour has a deeper `-mark` twin for places that are not the page: the thin bar beside a highlight in the list and the dots in its menu. The colours have no names or meanings; the reader decides what yellow means. Everything else in the Library stays neutral; primary buttons remain near-black and there is no brand accent.

To calm a colour, lower the chroma of its token. Don't add `muted-*` variants: in shadcn, `muted` is a neutral surface role, not a softer copy of another colour. Use opacity on the same token for fills, for example `bg-destructive/10`, but not for text people need to read.

**Contrast.** Readable text meets WCAG AA (4.5:1) on every surface it can sit on, including hover and selection fills. Secondary text uses `muted-foreground` at full strength. Don't fade it further with opacity; if something should look lighter, it probably belongs behind a hover instead. Decorative marks (separator dots, idle plan circles) can be fainter.

## Typography

- **Figtree** for the whole interface: round, open and friendly at small sizes.
- **Instrument Serif** for the Chat greeting only. Never for page titles, paper titles, body text or controls: a long title set in it is tiring to read.
- The scale is 22px (page titles), 18px (a paper's title on its own page), 15px (body and messages), 14px (UI), 13px (secondary: pickers, chips, small buttons) and 12px (captions: group labels, status chips, meta lines). Nothing smaller, and no in-between sizes like 0.8rem or 11px.
- Weight does the work of hierarchy before size or colour does. Medium (500) is the heaviest weight in UI chrome, including table headers. Semibold appears only in rendered markdown headings and bold text.
- Code is the system monospace at 0.85em, on a `muted` fill.

## Layout

- The frame is a 4px gap (`frame-gap`) around the main sheet. The icon rail is 32px buttons plus one frame gap on each side.
- The list panel and main area form one sheet, split by a 0.5px hairline. The list panel has a fixed width, so collapsing clips it rather than squeezing it.
- Messages and the composer share one centred column, at most 768px wide with a 16px gutter. Messages fade out above the composer instead of running into it.
- Library pages use the same 768px column, widening for the table layout. The whole page scrolls, header included.
- List rows are 36px and menu rows are 32px. Rows in a list or tree sit 2px apart, so two filled rows side by side (the open item, a hover, a drop target) never merge into one block. Menu rows touch.
- Grouped lists follow a spacing ladder: a label sits closest to its own rows, rows are evenly spaced, and the gap between groups is clearly the largest. If two of these distances look alike, the grouping stops reading.
- Dividers stop at the text edges rather than running edge to edge.

## Elevation & Depth

- Layers are told apart by tone first (see the surface table). Lines and shadows come second.
- Shadows are for things that float or that the user acts on: the composer, menus, dialogs and floating buttons. Content never gets a shadow.
- Focus on a text field darkens its border; there is no halo ring. The composer does the same at a larger scale: its border darkens and its shadow deepens.
- Focus marks are for keyboard navigation. Controls (buttons, tabs, chips, rows) show their focus ring only after Tab, arrows or Esc; after a click, a control that gets focus back, such as a menu trigger when its menu closes, shows nothing. Text fields are the exception: they darken their border however they were reached. In code this is the `focus-key:` variant; `focus-visible:` is kept for text fields.
- A control that floats over content, such as the scroll-to-bottom button, uses the `popover` surface and a soft shadow so it never reads as part of the text beneath.
- Dialogs dim and blur what is behind them.

## Shapes

| Element | Radius |
|---|---|
| Base `--radius` | 10px |
| Main sheet, cards, code blocks | 10px |
| Composer, menus, dialogs | 14px |
| Rows inside menus and lists, status chips, small buttons | 8px |
| Starter chips, send button, floating buttons | full |

- Nested corners are concentric: the outer radius equals the inner radius plus the padding between them.
- Similar curves shouldn't stack in the same corner. A larger shape inside a smaller one gets the larger radius, as the composer does inside the main sheet.

## Components

- **List panel.** A search field that opens the palette, a full-width "New chat" row, then chats grouped by recency. Titles use the full row. Hovering a row (or focusing it, or opening its menu) shows a vertical ellipsis in a small square, and only then does the title make room for it. The square darkens on its own hover while the row stays lit.
- **Composer.** Three plain-text pickers on the right: agent, model with reasoning effort, and permission mode marked by a shield. All three use the same muted tone. The model and effort read as "Sonnet 5.5 · Medium", and effort is a submenu row inside the model menu. A one-line banner appears inside the composer only when the selected agent can't run. In a narrow composer (under 448px, as in the agent window) the effort and the permission mode's name drop out of the triggers, leaving the model name and the shield; both stay one click away in their menus.
- **Command palette.** ⌘K anywhere opens one palette for the whole app: papers, docs and chats, with the place you are in first. Its actions are New chat and New doc; the one that belongs to the current place comes first and shows ⌘N. Before anything is typed each group shows its six most recent items. Every typed word has to appear in what an item is known by (title, authors, venue, tags, ids, abstract; a doc's folder and text; a chat's own words); a match in the title ranks first. Rows are a kind icon, the title, and muted details on the same line.
- **Starter prompts.** Words only, on a translucent `secondary` fill with full rounding. No outline, so they don't stack another border under the composer's, and no icons.
- **Menus.** Words only. The selected item has a check mark on the right; status is a small chip in the same right-hand slot. A destructive item is red text at rest and fills solid red when highlighted.
- **Mentions.** Muted blue text. In messages, no fill until hover. In the composer, a faint fill so the token reads as one unit. Wherever a mention is read (an answer, a doc), clicking it opens the paper or doc it names, and a paper's full title shows on hover. The `@` popup lists the same things everywhere: the Library's papers, the workspace's docs, and knowledge.
- **Assistant turn.**
  - Thoughts and tool calls fold into one "N steps" line. It opens while the agent is working (including when work resumes after a permission) and closes when the answer starts.
  - Inside, each step is one muted row: kind icon and title. Finished rows carry no mark. Only waiting (dashed circle), running (spinner) and real failure (red ×) get one. Chevrons appear on hover or while a row is open.
  - The collapsed line adds "· N failed" in red only for real failures.
  - A pending permission is the only card: the action, three buttons and a warning-coloured shield. Once answered, the card goes away and the outcome ("Allowed once", "Rejected") sits inline on its tool call row as a lighter detail. It is never a separate line and never red.
  - A plan is a ruled checklist with a "done of total" count.
  - The answer is markdown body text. Under it, the model name and time sit flush with the answer's left edge. Copy, Save as doc and regenerate appear after them on hover, so they never push the meta line in. Save as doc keeps the answer as a doc titled after the chat, where new docs land, and its toast offers Open.
  - A message sent with a selected passage carries it as one muted quoted line above the bubble, with a thin rule at its edge.
- **Tables (in answers).** Ruled, not boxed: a tinted header row with rounded ends, a hairline under each body row, and no outer frame or column lines. Headers are medium weight.
- **Fields.** Focus darkens the border, with no halo ring. An invalid field gets a red border, also without a ring.
- **Forms.** One field per line, a small muted label above each input, an optional one-line hint below, and actions right-aligned at the bottom with the primary button last. A form inside a dialog sits in its own bordered panel with a short title.
- **Dialogs.** The title carries an info icon instead of a description paragraph. Content is one bordered list with dividers, one line per row. Row actions are icon buttons with tooltips. Secondary forms are folded behind a text button; Esc folds them before it closes the dialog.
- **Local agents dialog.** A ready agent shows its name and version, quietly. An agent that isn't installed shows a "Not installed" chip, plus a second line with its install command in muted monospace, next to a copy button. A broken agent shows a red "Error" chip and the error on the second line.

### Library

- **Structure.** The Library is a page titled "Library" with two underline tabs, **Up next** and **All papers**; a third (Feed) may join later. It has no list panel: its filters live in the page. Up next will hold what to read next, chosen by owlit and agents; its content is still to be designed, so for now it is an empty state.
- **Three levels, one job each.** A row identifies a paper, a peek decides whether to read it, the paper page is for reading. Click goes one level deeper; Esc or Back goes one level up. Each fact has one home and one look: status is a text menu ("Unread ▾") in the peek and on the paper page and nowhere else; in the list it shows only through tone.
- **Header.** The 22px title, then the tabs, with a sort menu and a List / Table toggle at the right end of the tab line.
- **Find field.** One field to find and to add: a bright `card` field with a border and no shadow (the composer is the only lifted input); focus darkens the border. Words filter the list. A DOI, arXiv id or link replaces the list with one card: "Looking up…", then the paper with Add (Enter), or "Already in your library" with Open. A paperclip adds a PDF file; dropping a PDF anywhere on the page also works. `/` focuses it.
- **Filters.** Rounded chips All · Reading · Starred · Unread · Read with counts, then a Tags menu at the right end of the same line (dot, name, count; picks stay open). Picked tags show as chips with a remove ×. Chips are for filters only; pages are tabs, so a page and a filter never look alike.
- **Rows (list layout).** One 36px line: title, short authors · year in muted text, a star mark if starred. Grouped by when they were added (Today, Previous 7 days, Previous 30 days, Earlier), by year when sorted by year. Read papers have a muted title. No tags, dates, status glyphs or reading progress on rows. Hover shows a star toggle and a vertical ellipsis.
- **Table** (the default layout). The same ruled look as answer tables: a tinted header with rounded ends, square body cells, a hairline under every row but the last, plus a square hover fill. A 4px band of sheet sits under the header so a filled first row never merges with the header's tint. Columns: Title · Authors · Year · Venue · Tags (first tag with its dot, then "+N") · Status (blank when unread) · Added. Headers sort; on hover the date gives way to the row's actions.
- **Peek.** A plain click opens the row in place as a raised card: full title, all authors, venue and year, the abstract, then one line with tags, status menu, star, ellipsis and the primary button (Read, Continue or Open). One peek at a time; ↑↓ move it, Space toggles it, Enter opens the paper.
- **Selection.** Nothing is selected until the user clicks; coming back from a paper keeps only the keyboard cursor, not a highlight. ⌘-click and ⇧-click select without peeking. Two or more selected bring up a floating bar at the bottom: "N selected · Star · Mark as · Add tag · Remove · ×".
- **Paper page.** A breadcrumb "Library › title", "N of M" with previous and next, and a details toggle, with no rule under them. The reader sits on a well one step darker than the sheet so pages are the brightest surface. The details panel has the 18px title, authors and venue, one control line (status, star, ellipsis), and underline tabs Notes · Highlights · About. It is 380px by default; its left edge drags between 320px and half the page, and a double-click puts it back. Its width, whether it is open, and the last tab used carry over from paper to paper.
- **Reader.** White pages with a hairline edge, 24px of well around them and 16px between them, fitted to the width. Two floating pills and no toolbar: zoom and find at the top right (the percentage is the control: it cycles fit width, 100% and fit page; ⌘F opens find in its place), and the page number at the bottom centre. Both use the menu material (popover surface, hairline ring, soft shadow). The page number sits on the text, so it shows while the reader scrolls or points at it and fades once they stop; after a link inside the PDF has moved the reader it gains "← N", which returns to where the link was followed, and stays until used. Find starts from the current page and brings each match into view; all matches get a neutral tint, so they never pass for a highlight, and the current one is orange. Internal links (citations, section references) are a thin rule under the text, never a fill; external links are not followed. A paper reopens exactly where it was left, with nothing to say so.
- **Text in the PDF.** Selecting text brings up one popover beside it, in the menu material: four colour dots (the current colour carries a check, as a selected menu item does), then Copy and Comment as icon buttons with tooltips. A dot keeps the selection as a highlight. Comment keeps it in the last colour used and opens a comment field in the same popover, saved as it is typed; ⌘↵ or Esc closes it. Clicking a highlight brings up the same popover with its colour marked and Delete added, so a highlight looks like a selection that was kept. 1–4 pick a colour and ⌘C copies while it is open. Copied text has line breaks and end-of-line hyphens mended. Under the pointer, a highlight turns a step deeper so it reads as something to click, and a commented one shows its comment; nothing else marks it on the page.
- **Highlights tab.** Reading order, grouped under 12px "Page N" labels; the tab shows the count in muted text, and "Copy all" (Markdown quotes with page numbers) sits at the right end of the tab line. Each item is the quote, up to four lines, beside a 3px bar in its colour, with the comment under it in body text. Click jumps the reader to the passage and rings it twice; a highlight clicked in the PDF is marked and scrolled into view here. Hover shows a vertical ellipsis: Color, Edit comment, Copy, Add to note, Delete.
- **Notes tab.** One note per paper, stored as Markdown and drawn with the same styles as answers. It has no box or fill: the panel is its page, the note is content rather than a form, and the composer stays the only lifted input. The empty space under the text belongs to the note, so a click there puts the cursor at the end. Markdown shortcuts as you type, and @ for the same mention popup as the composer. In Markdown a mention is a link to its `owlit://` address, the form agents use. Add to note appends the highlight as a quote whose "p. N" is a link back to the passage. It saves on every change and never says "Saved".
- **Citations.** Every paper menu has Copy citation (APA 7) and Copy BibTeX; with several papers selected they copy one entry per paper, and the floating bar has Copy BibTeX too. BibTeX keys follow the familiar `vaswani2017attention` shape, titles keep their capitals in double braces, and the entry type comes from what kind of publication it is (an arXiv id alone is a preprint).

### Docs

- **Structure.** Docs are the Markdown files in the workspace folder, shown as they are on disk, for quick notes and drafts alike: no doc types, no templates, no required title. A paper's own note is not a doc; it stays on the paper page.
- **List panel.** The same search field as Chat's, opening the palette (which finds a doc by its name, folder or text), a "New doc" row (with a New folder icon button that shows on hover), then the folder tree. Folders are a chevron and a name; files are their title alone. Folders come first, then files, each by last edit, newest first; a folder counts as edited when anything inside it is. Tree rows are 32px, a step tighter than list rows, because a tree runs long. The workspace's `library/` and dot-folders are hidden; files that aren't Markdown show in muted text and open in the system app. There is no separate Recent group: Home, ⌘K and the edit-time order already lead back to recent docs.
- **Organising.** Rows have the Chat list's hover ellipsis: Rename and Delete for a doc; New doc, New folder, Rename and Delete for a folder. Renaming happens in place on the row. Dragging a row onto a folder moves it there, onto empty space moves it to the root. Delete is immediate and offers Undo in its toast.
- **New doc.** ⌘N or the New doc row. It never asks where to go: it lands in the folder last clicked or the open doc's folder, else at the workspace root. The first line is the title. Until the user renames the file, its name follows the first line; an empty first line names it by time (`2026-10-08 21.35.md`). Nothing is ever called "Untitled". A new doc left without a single character is gone once the user moves on.
- **Editor.** The text on disk is the document: opening a file and leaving it never changes a byte, and syntax owlit doesn't know passes through untouched. Markdown marks hide while the cursor is away from them and come back on the line being edited; an unfocused doc reads clean. Headings, emphasis, ==highlights==, links, lists, task boxes, quotes, rules and code are drawn in place; tables, math, embeds and callouts are to follow. Body text is 15px in the 768px column under a one-line header (the folder path and the title, an ellipsis menu at the right); there is no toolbar. The title line is 22px medium; headings below it are 18px and 15px semibold. Front matter shows as quiet monospace and is never read as the title. It saves on every change and never says "Saved", and a doc reopens with the cursor where it was left.
- **Citations in docs.** @ opens the same mention popup as the composer. On disk a mention is a link to its `owlit://` address; on screen it is drawn like every other mention, one token that is deleted whole and opens its item on click. A paper is cited the way a writer would, "Vaswani et al. 2017", with its full title on hover.
- **Selection.** Selecting text (three characters or more) brings up Ask · Rewrite · Find support above it, in the menu look, while the editor has focus. Ask opens the agent window with the passage attached and waits for the question; Rewrite and Find support send at once.
- **Agent edits.** An edit the agent proposes is shown in place before anything changes: removed words struck through in the muted tone, new words on a faint `success` tint (mentions inside them already drawn as mentions), and one line under them, "Suggested by the agent", with Discard and Apply. Removal is not an error, so it is never red. Apply and Discard answer the agent's permission request, the same one its card in the conversation answers, so either place works. An applied edit lands as one change: ⌘Z takes it back, and its toast offers Undo.
- **Agent notes.** A note the agent leaves on a passage is a small marker in the margin beside its paragraph; clicking it opens a card with who wrote it and when, the note, and actions. Notes are kept beside the file, never written into it. If the passage changes outside owlit and can't be found again, the note says so instead of disappearing.

### Agent window

- **One window, everywhere but Chat.** ⌘J, the button at the right end of the top bar, or Ask on a selection calls it. At rest nothing shows.
- **Ask bar, then panel.** It first appears as a small ask bar floating at the bottom centre of the page, on the `card` surface with the composer's radius and shadow. The first message turns it into a docked panel, so a quick question stays light and a conversation never covers the text. The bar holds one line: a selection chip if there is one, the input and the send button. Once a conversation is going, ⌘J opens the panel directly, including after a reload. Esc closes either. Toasts move clear of the docked panel so they never cover its composer.
- **Docked panel.** The third part of the sheet: 400px on the `sidebar-panel` tone, split from the page by the same hairline as the list panel. While it is open the list panel folds, so the page keeps its full column; closing it brings the list back. The right side holds one panel at a time: on a paper page it takes the details panel's place.
- **It is a chat.** Each conversation is an ordinary chat and appears in the Chat list. The header has the chat's title (a menu to switch chats), New chat, Open in Chat and Close.
- **Context.** Removable chips above the input name what the agent can see: the doc or paper on screen, and a selection if one was sent. The page chip follows the user as they move; the conversation stays. A selection is used once: when it is sent its chip goes, and the selection stays in the thread as a short muted quote above the message it was sent with.

## Do's and Don'ts

Do:

- Reach for tone before lines, and words before icons.
- Put the fix next to the problem: an install command, an error message, a retry.
- Keep a concept's look identical everywhere it appears.
- Change the shared component when a rule changes, then update this file.
- Check contrast on hover and selection fills, not just on the bare surface.

Don't:

- Use status dots or "Connected" labels for healthy states.
- Put an icon in front of every menu item, or a tick on every finished step.
- Use red for anything the user chose.
- Use coloured or tinted cards for routine process steps, or repeat a step on a line of its own.
- Use two-line rows where a title plus an inline muted detail fits.
- Show reading progress (rings, bars, "p. 6 of 19") in lists; a paper simply reopens where it was left.
- Use the same look for a page switch and a filter.
- Use raw Tailwind palette colours (`emerald-*`, `amber-*`, `blue-*`) in feature code.
- Override padding or radius in a single menu; change the shared component instead.
- Use opaque grey fills for hover, selection or chips.
- Fade readable text with opacity.
- Put focus rings or halos on text fields.
- Squeeze several inputs onto one line.
- Box tables with full grids, or outline chips that sit next to bordered surfaces.
- Write description paragraphs under dialog titles, put text labels on self-explanatory icon buttons, or leave secondary forms always open.
- Hide the one thing a user needs (a fix, a full title) behind a tooltip.
- Use type sizes outside 22, 18, 15, 14, 13 and 12px in the UI.
