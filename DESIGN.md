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
  star: "oklch(0.64 0.13 72)"
  note: "oklch(0.76 0.15 75)"
  text-highlight: "oklch(0.93 0.11 98)"
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
  note-underline:
    textColor: "{colors.note}"
  doc-highlight:
    backgroundColor: "{colors.text-highlight}"
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

**How to use this file.** This is owlit's visual system: how things look, not what they do. What a page does is described by its code. Read this file before changing any interface, and update it in the same change whenever a style decision changes. The front matter holds the tokens. The sections below say why they're set that way and how to apply them. Live values are in `app/src/index.css`, and shared component styling is in `app/src/components/ui/`. When a token changes, change the CSS and this file together. When a rule changes for a component, change the shared component, not each place that uses it. Check the file with `npx @google/design.md lint DESIGN.md`: it should report no errors. Expect contrast warnings on the translucent fills (the linter ignores their alpha), and orphan warnings for `border`, `input` and `success`, which the format can't attach to a component.

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

Words the interface uses, and what each one names on screen.

- **Owlit**: the assistant. Whatever it says, edits or notes is signed Owlit ("Chat with Owlit", "Suggested by Owlit", "Owlit · Oct 6"). The agent running underneath is named only where it's chosen: the composer's agent picker and Settings › Agents.
- **Agent**: the local coding agent behind Owlit (Claude Code, Codex, Gemini CLI or a custom command). Not a name the user is asked to talk to.
- **Connector**: reserved for data sources and MCP servers. Don't use it for agents.
- **Steps**: the agent's thoughts and tool calls for one answer, shown as one foldable block.
- **Agent window**: the app-wide panel for talking to Owlit without leaving the page, labelled "Owlit" on screen.
- **Knowledge**, **topic**, **line**, **connection**: Knowledge holds topics; a topic is short lines, each with a speaker; a connection is an item on a paper's Knowledge tab.

## Colors

Neutrals carry a faint warm tint (hue 60 to 85, chroma under 0.012), so greys read as paper rather than steel. Every colour is a semantic token; feature code never uses raw palette colours. The theme follows the system's light or dark setting unless Settings › Appearance fixes it to Light or Dark.

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

Text and accents in dark mode: `foreground` 0.935, `muted-foreground` 0.7, `mention` `oklch(0.78 0.07 255)`, `warning` `oklch(0.78 0.11 75)`, `destructive` `oklch(0.68 0.13 22)`, `star` `oklch(0.8 0.12 80)`, `note` `oklch(0.8 0.13 78)`, `text-highlight` `oklch(0.4 0.07 100)`; tag hues lift to lightness 0.7 to 0.8 with slightly lower chroma. State fills become 7 to 8% tints of near-white, and borders become 10% white.

**Paper tones.** The neutrals come in four tones the user picks in Settings › Appearance: **Warm** (the values above, the default), **Neutral** (chroma 0), **Slate** (hue 255, chroma up to 0.02) and **Sepia** (hue 65 to 85, chroma up to 0.05, with a card that is not pure white). A tone swaps the whole neutral family at once: surfaces, text, lines and state fills. Each tone keeps Warm's lightness steps in both themes, so depth and contrast read the same; only hue and chroma move. Marks that carry meaning never change with the tone: `mention`, `warning`, `destructive`, `success`, `star`, `note`, `text-highlight`, the tag hues and every PDF colour. There is no accent colour to pick; primary buttons stay the tone's near-black (near-white in dark mode). The tone blocks in `index.css` also apply to any element with `data-tone`, which is how the tone picker draws each tone with its real tokens.

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
| `star` | A starred paper: the small filled star after its title, and the active star toggle. Deep enough for 3:1 against every fill it sits on, since the star alone carries its meaning |
| `note` | An agent's note on a passage: the 2px underline under its words, the wash on them while the note is open, and the open note's left edge. Also the 8px dot that marks a Knowledge topic, line or connection Owlit added or changed since the user last looked. A warm amber (hue 75), lighter than `warning` so it reads as a mark, not an alarm |
| `text-highlight` | A doc's own `==highlights==`: the lemon of a yellow PDF highlight, so a highlight looks the same in a paper and a doc, and never passes for a note's amber wash. Deep olive in dark mode, so light text stays readable on it |
| `tag-*` | Eight low-chroma hues. Each tag gets one, picked from its name so it is the same everywhere, shown only as a small dot beside the tag's name. Where a tag can be acted on (the peek, About) the dot and name sit on a `muted` chip that opens the tag and shows × on hover; read-only places (table, menus) show the dot and name bare |

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
- **Window (macOS).** There is no system title bar and no title: the traffic lights sit in owlit's 40px top bar, centred on its middle line, and the bar itself drags the window (a double-click zooms or minimises, as the system setting says). Back, Forward and the panel toggle start after the traffic lights; in full screen, where the lights are hidden, the room closes up and they sit over the icon rail again. The window still carries the workspace's name for Mission Control and the Window menu; switching workspaces is File › Open Workspace… (⌘O) and Open Recent.
- The list panel and main area form one sheet, split by a 0.5px hairline. The list panel has a fixed width, so collapsing clips it rather than squeezing it.
- Messages and the composer share one centred column, at most 768px wide with a 16px gutter. Messages fade out above the composer instead of running into it.
- Library pages use one wider column (at most 1152px) for every tab and layout, so switching between Up next and All papers, or list and table, never moves the header. The whole page scrolls, header included.
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

- **List panel.** A search field, a full-width "New chat" row, then chats grouped by recency. Titles use the full row. Hovering a row (or focusing it, or opening its menu) shows a vertical ellipsis in a small square, and only then does the title make room for it. The square darkens on its own hover while the row stays lit.
- **Composer.** Three plain-text pickers on the right: agent, model with reasoning effort, and permission mode marked by a shield. All three use the same muted tone. The model and effort read as "Sonnet 5.5 · Medium", and effort is a submenu row inside the model menu. A one-line banner appears inside the composer only when the selected agent can't run. In a narrow composer (under 448px, as in the agent window) the effort and the permission mode's name drop out of the triggers, leaving the model name and the shield; both stay one click away in their menus.
- **Command palette.** Groups by kind, the current place's group first. Rows are a kind icon, the title, and muted details on the same line. The palette's actions come first, the one for the current place showing its shortcut.
- **Starter prompts.** Words only, on a translucent `secondary` fill with full rounding. No outline, so they don't stack another border under the composer's, and no icons.
- **Menus.** Words only. The selected item has a check mark on the right; status is a small chip in the same right-hand slot. A destructive item is red text at rest and fills solid red when highlighted.
- **Mentions.** Muted blue text. In messages and docs, no fill until hover. In the composer, a faint fill so the token reads as one unit. A paper's full title shows on hover.
- **Assistant turn.**
  - Thoughts and tool calls fold into one "N steps" line. It opens while the agent is working (including when work resumes after a permission) and closes when the answer starts.
  - Inside, each step is one muted row: kind icon and title. Finished rows carry no mark. Only waiting (dashed circle), running (spinner) and real failure (red ×) get one. Chevrons appear on hover or while a row is open.
  - The collapsed line adds "· N failed" in red only for real failures.
  - A pending permission is the only card: the action, three buttons and a warning-coloured shield. Once answered, the card goes away and the outcome ("Allowed once", "Rejected") sits inline on its tool call row as a lighter detail. It is never a separate line and never red.
  - A plan is a ruled checklist with a "done of total" count.
  - The answer is markdown body text; math is drawn as in docs, inline, and display math as a centred block that scrolls sideways when wide. Under it, the model name and time sit flush with the answer's left edge. Copy, Save as doc and regenerate appear after them on hover, so they never push the meta line in. Under it, the model name and time sit flush with the answer's left edge. Copy, Save as doc and regenerate appear after them on hover, so they never push the meta line in.
  - A message sent with a selected passage carries it as one muted quoted line above the bubble, with a thin rule at its edge.
- **Tables (in answers).** Ruled, not boxed: a tinted header row with rounded ends, a hairline under each body row, and no outer frame or column lines. Headers are medium weight.
- **Fields.** Focus darkens the border, with no halo ring. An invalid field gets a red border, also without a ring.
- **Forms.** One field per line, a small muted label above each input, an optional one-line hint below, and actions right-aligned at the bottom with the primary button last. A form inside a dialog sits in its own bordered panel with a short title.
- **Dialogs.** The title carries an info icon instead of a description paragraph. Content is one bordered list with dividers, one line per row. Row actions are icon buttons with tooltips. Secondary forms are folded behind a text button.
- **Settings.** One dialog (the sidebar-in-a-dialog shape): sections listed on the left on the `sidebar-panel` surface, each with its icon, and one section on the right under its title and info icon. A section's list shows a small `warning` dot only while something in it needs the user. Every section is one or two bordered lists on `card`, one setting per row: the name (with an info icon for any explanation) at the left, the control at the right. Controls are a plain-text picker with up-down chevrons that opens a words-only menu, a switch, a segmented control (the theme), or a 32px field. There is no Save button. A key shows as dots and its last four characters with Change, and Remove on hover. A check of a key or address shows as one muted line under its row; only a refusal is red. A group label (12px muted) sits above a second list in the same section. Paper tones are picked from small pictures of the app (frame, list panel, sheet) drawn in each tone, the chosen one ringed in `foreground`.
- **Settings › Agents.** A ready agent shows its name and version, quietly; its re-check icon appears on hover. An agent that isn't installed shows a "Not installed" chip, plus a second line with its install command in muted monospace, next to a copy button. A broken agent shows a red "Error" chip and the error on the second line. "Add an agent" is a text button that unfolds a bordered form under the list.
- **Settings button.** A gear at the bottom of the icon rail, apart from the places, with "Settings" in its tooltip. It opens the dialog and never takes the rail's selected look.

### Library

- **Header.** The 22px title, then underline tabs, with a sort menu and a List / Table toggle at the right end of the tab line.
- **Pages and filters.** Pages are underline tabs; filters are rounded chips with counts, followed by a Tags menu (dot, name, count) at the right end of the same line. Picked tags show as chips with a remove ×. A page and a filter never look alike.
- **Find field.** A bright `card` field with a border and no shadow (the composer is the only lifted input); focus darkens the border. A looked-up paper shows as one card in place of the list.
- **Rows (list layout).** One 36px line: title, a star mark if starred (the star belongs to the title, in both layouts), then short authors · year in muted text. Read papers have a muted title. No tags, dates, status glyphs or reading progress on rows. Hover shows a star toggle and a vertical ellipsis.
- **Text matches.** While searching, a paper found in its text rather than its details takes a second line under its title, in both layouts: a 12px muted snippet with the matched words in body text.
- **Table.** The same ruled look as answer tables: a tinted header with rounded ends, square body cells, a hairline under every row but the last, plus a square hover fill. A 4px band of sheet sits under the header so a filled first row never merges with the header's tint. Long venue names shorten to their initials, with the full name on hover; tags show the first tag with its dot, then "+N"; status is blank when unread. The title never gets narrower than 320px: when the table can't fit, Venue, Status, Tags and Authors give way in that order. Read status shows once: as the word in Status, or, when that column has given way, as a muted title. On hover the date gives way to the row's actions.
- **Peek.** The row opens in place as a raised card: full title, all authors, venue and year, the abstract, then one line with tags, status menu, star, ellipsis and the primary button.
- **Selection bar.** Two or more selected papers bring up a floating bar at the bottom: "N selected · Star · Mark as · Add tag · Remove · ×".
- **Paper page.** A breadcrumb with "N of M", previous and next, and a details toggle, with no rule under them. The reader sits on a well one step darker than the sheet so pages are the brightest surface. The details panel has the 18px title, authors and venue, one control line (status, star, ellipsis), and underline tabs. It is 380px by default, and its left edge drags between 320px and half the page.
- **No PDF.** Where the reader would be, one dashed drop card: a 15px medium line ("No PDF yet", "Looking for a PDF…" with a spinner, "No PDF found"), what was tried as one plain muted sentence ("Tried arXiv and the publisher."), then two small buttons, Try again (default) and Choose file (outline).
- **Digest.** In About under the abstract: a 12px muted "Digest" label, then the reading note's Markdown in 14px. While one is being written, the label stands over one muted line with a spinner.
- **How the text was read.** About's last row: "Full" in body text, or "Basic" in muted text. Nothing else on the page marks it.
- **Reader.** White pages with a hairline edge, 24px of well around them and 16px between them, fitted to the width. Two floating pills and no toolbar: zoom and find at the top right (the percentage is the control), and the page number at the bottom centre. Both use the menu material (popover surface, hairline ring, soft shadow). The page number shows while the reader scrolls or points at it and fades once they stop. Find gives all matches a neutral tint, so they never pass for a highlight, and the current one is orange. Internal links are a thin rule under the text, never a fill.
- **Text in the PDF.** Selecting text brings up one popover beside it, in the menu material: four colour dots (the current colour carries a check, as a selected menu item does), then icon buttons with tooltips. Clicking a highlight brings up the same popover with its colour marked, so a highlight looks like a selection that was kept. Under the pointer, a highlight turns a step deeper so it reads as something to click, and a commented one shows its comment; nothing else marks it on the page.
- **Highlights tab.** Grouped under 12px "Page N" labels; the tab shows the count in muted text, with its one action at the right end of the tab line. Each item is the quote, up to four lines, beside a 3px bar in its colour, with the comment under it in body text. A passage jumped to is ringed twice. A highlight Owlit made carries one 12px muted line under it, "Added by Owlit"; in the PDF it looks like any other.
- **Notes tab.** The note has no box or fill and uses the same styles as answers: the panel is its page, the note is content rather than a form, and the composer stays the only lifted input.
- **Knowledge tab.** Each connection reads in three steps: whose thing it is, in 12px muted text; their own words, quoted in 13px muted text; then the relation in 14px body text as one sentence starting with a `mention`-coloured section link. The passage is folded under a "Passage" text button that shows on hover, drawn as a quote with a thin rule at its edge. A line taken into a topic reads in full tone with Edit beside it. Group names are the relations, and one info icon on the first group label explains the tab. Hovering an item outlines its passage in the PDF with a 2px ring in the PDF link blue (the light theme's `mention`, fixed because the page is white in both themes); a jump rings it twice. The PDF gets no lasting mark. The tab label carries no count, only a `note` dot while a guess is unseen.

### Docs

- **Tree.** Folders are a chevron and a name; files are their title alone, after an empty chevron-wide slot, so every name at the same depth starts at the same place and a folder's contents start one step in from its name. Tree rows are 32px, a step tighter than list rows, because a tree runs long. A name cut short shows in full on hover. A row holding keyboard focus lights up like a hovered one and shows its ellipsis. Files that aren't Markdown show in muted text.
- **Editor.** Body text is 15px in the 768px column under a one-line header (the folder path and the title, an ellipsis menu at the right); there is no toolbar. The header starts at the sheet's edge, as the paper page's breadcrumb does, not at the text column. Markdown marks hide while the cursor is away from them and come back on the line being edited; an unfocused doc reads clean. Drawn in place:
  - **Tables**, with the answer tables' ruled look.
  - **Math**, inline, and display math as a centred block.
  - **Callouts**, as a quiet tinted box: the type as a plain muted word, the title in medium weight.
  - **Wikilinks**, drawn as a mention when they name a doc in the workspace, and as muted text with a dotted underline when they don't.
  - **Embeds**, as a small muted chip with the file's name.
  - **Headings**, sized by rank under the title, not by their number of `#`s: the title line is 22px medium, the shallowest level below it 18px semibold, and anything deeper 15px semibold. A heading gets extra room above it and none below, so it reads as the start of what follows.
  - **Lists hang.** A list marker sits in a 1.5em box, and the item's text, wrapped lines included, starts after it. Each level of nesting steps in by one box, whatever spaces the file uses.
  - **Code blocks** hide their fences while the cursor is outside the block; the language sits in 12px muted text in the block's top right corner.
  - **Front matter** folds into one 12px muted line of its fields above the title while the cursor is elsewhere, and shows as quiet monospace when clicked.
- **Selection menu.** One compact item 8px above the selection: a single 24px row in a 2px frame, so it covers as little text as possible.
- **Agent edits.** Shown in place: removed words struck through in the muted tone, new words on a faint `success` tint (mentions inside them already drawn as mentions), and one line under them, "Suggested by Owlit", with Discard and Apply. Removal is not an error, so it is never red.
- **Versions dialog.** From the doc's ellipsis: "Versions of Name" with one muted line under the title, then one row per version, newest first: a 14px label, and under it in 12px muted text the time and the chat it came from. Restore is a ghost button that appears on hover.
- **Agent notes.** A note underlines exactly the words it is about: a 2px solid underline in the `note` amber, below link underlines and thicker than them, so the two never read alike. There is no icon, no margin mark and no right-hand comment column. While a note is open its words take a wash of the same amber. The note opens under the paragraph, pushing the text down rather than covering it. An open note must never read as the writer's own text, so it is a raised `card` with a hairline border, no shadow and a 3px `note` rule at its left edge: who wrote it and when in 12px muted text first, the note in 14px, then small text buttons at the bottom right. The doc header shows "N notes" in muted text, and an open note's top line ends in "2 of 7" with previous and next buttons.

### Knowledge

- **Topics page.** Like the Library's: the 22px title, then topics as 36px rows grouped by when they last changed (group labels only when there is more than one group). A row is the topic's name plus its one-line summary inline in muted text and the date at the right; no counts, no badges. The one mark is the `note` dot before the name of a topic Owlit changed since the user last looked. No tab strip until there is a second view, and no find field until the list is longer than a screen. Archived and loose material sit in one fold row at the bottom.
- **Topic page.** A breadcrumb with "Chat about this" and an ellipsis at the right. Then the name at 22px, one muted "Updated" line with an info icon, and the summary in 15px behind a thin left rule. When something changed since the user last looked, one line with a `note` dot says so. The blocks follow under 12px labels; the sources and the change log are closed folds. Nothing on the page is numbered: a line is named by its opening words.
- **Lines.** One sentence in 15px with its speaker in a 112px column at the left, written as a verb phrase ("**You** wrote", "**Chen 2025** found", "**Owlit** thinks"): the name medium weight, the verb muted. Under the sentence, in 13px muted text, its sources as mentions, then a condition as a full sentence. The only chip is "abstract only", and such a line is drawn in muted text. A `note` dot before the speaker marks a line Owlit changed since the user last looked, and a rewritten line shows "Was: “…”" in muted text under its sources until then. A line's history opens under it, ruled off from the line above.
- **In chat.** A Knowledge change made from a chat shows under the answer as one 13px muted row, "Updated · topic · “first words…”", with Undo and View.

### Agent window

- **Ask bar.** A small bar floating at the bottom centre of the page, on the `card` surface with the composer's radius and shadow. One line: a selection chip if there is one, the input and the send button.
- **Docked panel.** The third part of the sheet: 400px on the `sidebar-panel` tone, split from the page by the same hairline as the list panel. While it is open the list panel folds, so the page keeps its full column. The right side holds one panel at a time: on a paper page it takes the details panel's place. Toasts move clear of it so they never cover its composer.
- **Header.** The chat's title (a menu to switch chats), New chat, Open in Chat and Close.
- **Context.** Removable chips above the input. A selection, once sent, stays in the thread as a short muted quote above its message.

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
- Show reading progress (rings, bars, "p. 6 of 19") in lists.
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
- Put accept, confirm or triage controls, or unread counts, on what Owlit wrote; mark it with the `note` dot instead.
- Use type sizes outside 22, 18, 15, 14, 13 and 12px in the UI.
