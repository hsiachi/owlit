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
typography:
  display:
    fontFamily: Instrument Serif
    fontSize: 44px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.025em
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

Text and accents in dark mode: `foreground` 0.935, `muted-foreground` 0.7, `mention` `oklch(0.78 0.07 255)`, `warning` `oklch(0.78 0.11 75)`, `destructive` `oklch(0.68 0.13 22)`. State fills become 7 to 8% tints of near-white, and borders become 10% white.

The composer is the brightest thing in the main sheet, with a soft shadow. It's the place the user acts on most, so it is lifted rather than coloured.

Accent colours are low in chroma and used sparingly:

| Token | Role |
|---|---|
| `mention` | References to workspace items: papers, docs, knowledge |
| `warning` | Something waits on the user, such as a permission request or an agent that can't run |
| `destructive` | Errors and irreversible actions, never a user's own choice |
| `success` | Use rarely; completion is usually shown by quieting a row |

To calm a colour, lower the chroma of its token. Don't add `muted-*` variants: in shadcn, `muted` is a neutral surface role, not a softer copy of another colour. Use opacity on the same token for fills, for example `bg-destructive/10`, but not for text people need to read.

**Contrast.** Readable text meets WCAG AA (4.5:1) on every surface it can sit on, including hover and selection fills. Secondary text uses `muted-foreground` at full strength. Don't fade it further with opacity; if something should look lighter, it probably belongs behind a hover instead. Decorative marks (separator dots, idle plan circles) can be fainter.

## Typography

- **Figtree** for the whole interface: round, open and friendly at small sizes.
- **Instrument Serif** for display moments only, such as the empty-state greeting and, later, page titles. Never for body text or controls.
- The scale is 15px (body and messages), 14px (UI), 13px (secondary: pickers, chips, small buttons) and 12px (captions: group labels, status chips, meta lines). Nothing smaller, and no in-between sizes like 0.8rem or 11px.
- Weight does the work of hierarchy before size or colour does. Medium (500) is the heaviest weight in UI chrome, including table headers. Semibold appears only in rendered markdown headings and bold text.
- Code is the system monospace at 0.85em, on a `muted` fill.

## Layout

- The frame is a 4px gap (`frame-gap`) around the main sheet. The icon rail is 32px buttons plus one frame gap on each side.
- The list panel and main area form one sheet, split by a 0.5px hairline. The list panel has a fixed width, so collapsing clips it rather than squeezing it.
- Messages and the composer share one centred column, at most 768px wide with a 16px gutter. Messages fade out above the composer instead of running into it.
- List rows are 36px and menu rows are 32px.
- Grouped lists follow a spacing ladder: a label sits closest to its own rows, rows are evenly spaced, and the gap between groups is clearly the largest. If two of these distances look alike, the grouping stops reading.
- Dividers stop at the text edges rather than running edge to edge.

## Elevation & Depth

- Layers are told apart by tone first (see the surface table). Lines and shadows come second.
- Shadows are for things that float or that the user acts on: the composer, menus, dialogs and floating buttons. Content never gets a shadow.
- Focus on a text field darkens its border; there is no halo ring. The composer does the same at a larger scale: its border darkens and its shadow deepens.
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
- **Composer.** Three plain-text pickers on the right: agent, model with reasoning effort, and permission mode marked by a shield. All three use the same muted tone. The model and effort read as "Sonnet 5.5 · Medium", and effort is a submenu row inside the model menu. A one-line banner appears inside the composer only when the selected agent can't run.
- **Starter prompts.** Words only, on a translucent `secondary` fill with full rounding. No outline, so they don't stack another border under the composer's, and no icons.
- **Menus.** Words only. The selected item has a check mark on the right; status is a small chip in the same right-hand slot. A destructive item is red text at rest and fills solid red when highlighted.
- **Mentions.** Muted blue text. In messages, no fill until hover. In the composer, a faint fill so the token reads as one unit.
- **Assistant turn.**
  - Thoughts and tool calls fold into one "N steps" line. It opens while the agent is working (including when work resumes after a permission) and closes when the answer starts.
  - Inside, each step is one muted row: kind icon and title. Finished rows carry no mark. Only waiting (dashed circle), running (spinner) and real failure (red ×) get one. Chevrons appear on hover or while a row is open.
  - The collapsed line adds "· N failed" in red only for real failures.
  - A pending permission is the only card: the action, three buttons and a warning-coloured shield. Once answered, the card goes away and the outcome ("Allowed once", "Rejected") sits inline on its tool call row as a lighter detail. It is never a separate line and never red.
  - A plan is a ruled checklist with a "done of total" count.
  - The answer is markdown body text. Under it, the model name and time sit flush with the answer's left edge. Copy and regenerate appear after them on hover, so they never push the meta line in.
- **Tables (in answers).** Ruled, not boxed: a tinted header row with rounded ends, a hairline under each body row, and no outer frame or column lines. Headers are medium weight.
- **Fields.** Focus darkens the border, with no halo ring. An invalid field gets a red border, also without a ring.
- **Forms.** One field per line, a small muted label above each input, an optional one-line hint below, and actions right-aligned at the bottom with the primary button last. A form inside a dialog sits in its own bordered panel with a short title.
- **Dialogs.** The title carries an info icon instead of a description paragraph. Content is one bordered list with dividers, one line per row. Row actions are icon buttons with tooltips. Secondary forms are folded behind a text button; Esc folds them before it closes the dialog.
- **Local agents dialog.** A ready agent shows its name and version, quietly. An agent that isn't installed shows a "Not installed" chip, plus a second line with its install command in muted monospace, next to a copy button. A broken agent shows a red "Error" chip and the error on the second line.

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
- Use raw Tailwind palette colours (`emerald-*`, `amber-*`, `blue-*`) in feature code.
- Override padding or radius in a single menu; change the shared component instead.
- Use opaque grey fills for hover, selection or chips.
- Fade readable text with opacity.
- Put focus rings or halos on text fields.
- Squeeze several inputs onto one line.
- Box tables with full grids, or outline chips that sit next to bordered surfaces.
- Write description paragraphs under dialog titles, put text labels on self-explanatory icon buttons, or leave secondary forms always open.
- Hide the one thing a user needs (a fix, a full title) behind a tooltip.
- Use type sizes outside 15, 14, 13 and 12px in the UI.
