# owlit UI style

owlit should feel like a quiet desk for reading and thinking: warm paper tones, generous room, and an interface that steps back so papers, notes and answers stay in front. Nothing should compete with the content for attention unless something needs the user.

Tokens live in `app/src/index.css`; shared component styling lives in `app/src/components/ui/`.

## Principles

- **Silent when fine, clear when not.** A working state has no badge, dot or label. Only states that need the user speak: an agent that isn't installed, a pending permission, an error. When they speak, it's one small, specific line or card, not a colour wash.
- **One thing, one look.** A concept is drawn the same way everywhere it appears. A mentioned paper looks identical in the composer, in the user's message and in the assistant's reply. Every menu shares the same geometry.
- **Depth from tone, not lines.** Layers are told apart by small steps of background lightness. Borders are thin and light; shadows are soft and rare. Avoid stacking outlines.
- **Fewer marks.** Text before icons. Menu items are words only. Status icons, kind icons and decorative glyphs appear only where they help scan a long list.
- **Room to breathe.** Rows are tall enough to read without effort, popovers wide enough that titles don't truncate early, and secondary details sit inline in a lighter tone rather than stacked on a second line.
- **Words on demand.** Show what someone needs to act; keep the rest one hover or click away. A self-explanatory action is an icon with its label in a tooltip. An explanation sits behind an info icon. A secondary form stays folded behind a single text button until asked for. A row earns a second line only for a problem or for something the user typed.
- **Process recedes, results lead.** The agent's thinking, tool calls and plans are quiet, ruled lists that fold away. The answer is full-width body text.

## Colour

Neutrals carry a faint warm tint (hue 60 to 85, chroma under 0.012), so greys read as paper rather than steel. Every colour is a semantic token; feature code never uses raw palette colours.

Colour comes in two kinds:

- **Surfaces are opaque** and step up in lightness from back to front. Whatever sits further forward, or is meant to be used, is brighter.
- **State fills are translucent** tints of the text colour: `muted`, `secondary`, `accent` and `sidebar-accent`. Hover, selection, chips and code blocks use them. Because they tint whatever lies beneath, a chip on a hovered row or a hover on any surface is always one visible step darker, or lighter in dark mode. Never use an opaque grey for a state; two opaque greys will eventually collide.

Surfaces, back to front:

| Layer | Token | Light | Dark |
|---|---|---|---|
| Frame: top bar and icon rail | `--sidebar` | 0.942 | 0.155 |
| List panel | `--sidebar-panel` | 0.976 | 0.19 |
| Main sheet | `--background` | 0.99 | 0.215 |
| Raised: composer, inputs, cards, selected rail icon | `--card` | 1.0 | 0.245 |
| Floating: menus, dialogs | `--popover` | 1.0 | 0.255 |

The composer is the brightest thing in the main sheet, with a soft shadow. It's the one place the user acts on most, so it is lifted rather than coloured.

Accent colours are low in chroma and used sparingly:

| Token | Role |
|---|---|
| `--mention` | References to workspace items: papers, docs, knowledge |
| `--warning` | Something waits on the user, such as a permission request or an agent that can't run |
| `--destructive` | Errors and irreversible actions |
| `--success` | Completed tool calls; use rarely, completion is usually shown by quieting a row |

To calm a colour, lower the chroma of its token. Don't add `muted-*` variants: in shadcn, `muted` is a neutral surface role, not a softer copy of another colour. Use opacity on the same token for tints, for example `bg-destructive/10`.

## Type

- **Figtree** for the whole interface: round, open and friendly at small sizes.
- **Instrument Serif** for display moments only, such as the empty-state greeting and, later, page titles. Never for body text or controls.
- Body and message text is 15px with relaxed line height. Secondary text is 13px or 12px in `muted-foreground`.
- Weight does the work of hierarchy before size or colour does. Medium is the heaviest weight used in UI chrome.

## Shape and spacing

| Element | Value |
|---|---|
| Base radius `--radius` | 10px |
| Main sheet | 10px |
| Composer and popovers | 14px |
| Rows inside popovers and lists | 8px |
| Frame gap `--frame-gap` | 4px |
| Icon rail | 32px buttons plus one frame gap each side |
| List row | 36px |
| Menu row | 32px |

- Nested corners are concentric: an outer radius equals the inner radius plus the padding between them.
- Similar curves shouldn't stack in the same corner. A larger shape inside a smaller one gets the larger radius, as the composer does inside the main sheet.
- Dividers stop at the text edges rather than running edge to edge.
- Grouped lists follow a spacing ladder: a label sits closest to its own rows, rows are evenly spaced, and the gap between groups is clearly the largest. If two of these distances look alike, the grouping stops reading.
- The list panel and main area form one sheet, split by a 0.5px hairline.

## Components

- **List panel.** A search field that opens the palette, a full-width "New chat" row, then chats grouped by recency. Hovering a row shows a vertical ellipsis in a small square that darkens on its own hover while the row stays lit.
- **Composer.** Three plain-text pickers on the right: agent, model with reasoning effort as a submenu row, and permission mode marked by a shield. Focus lifts the composer with a shadow instead of a ring. A one-line banner appears inside it only when the selected agent can't run.
- **Menus.** Words only, check mark on the right for the selected item, status as a small chip in the same right-hand slot. A destructive item is red text at rest and fills solid red when highlighted.
- **Mentions.** Muted blue text. In messages, no fill until hover. In the composer, a faint fill so the token reads as one unit.
- **Assistant turn.** Thoughts and tool calls fold into one "N steps" line that opens while working and closes when the answer starts. A plan is a ruled checklist with a "done of total" count. A pending permission is the only card: the action, three buttons, a warning-coloured shield. Once answered it shrinks to one muted line. Model name and time sit under every answer.
- **Fields.** Focus darkens the border; there is no halo ring. An invalid field gets a red border, also without a ring. The composer follows the same idea at a larger scale: its border darkens and its shadow deepens.
- **Forms.** One field per line, a small muted label above each input, an optional one-line hint below, and the actions right-aligned at the bottom with the primary button last. A form inside a dialog sits in its own bordered panel with a short title.
- **Dialogs.** The title carries an info icon instead of a description paragraph. Content is one bordered list with dividers, one line per row. Row actions are icon buttons with tooltips. Secondary forms are folded behind a text button; Esc folds them before it closes the dialog.

## Avoid

- Status dots and "Connected" labels for healthy states.
- Icons in front of every menu item.
- Coloured or tinted cards for routine process steps.
- Two-line rows where a title plus an inline muted detail fits.
- Raw Tailwind palette colours (`emerald-*`, `amber-*`, `blue-*`) in feature code.
- Per-menu padding or radius overrides; change the shared component instead.
- Opaque grey fills for hover, selection or chips.
- Focus rings and halos on text fields.
- Several inputs squeezed onto one line.
- Description paragraphs under dialog titles, text labels on self-explanatory icon buttons, and always-open secondary forms.
