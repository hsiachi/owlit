# app

The renderer: React, Vite, Tailwind, shadcn. `src/features/<place>/` per place, shared pieces in
`src/components/`, shadcn primitives in `src/components/ui/`.

- **Read [DESIGN.md](../DESIGN.md) before changing anything people see.** Use its tokens, never raw
  Tailwind palette colours. A shape used in two places is a component in `src/components/`: change it
  there, never at one call site.
- **Leave DESIGN.md alone by default.** Edit it only when a token changes or when a rule that holds in two
  or more places is added or changed, and name that rule in the commit message. A size, colour or layout
  used in one place stays in that place's code, with its reason in a comment. When a rule is added, look
  for one it replaces or makes redundant and remove that one in the same edit.
- **shadcn (radix-nova)**: copy the official component or block markup; don't approximate it by hand.
- **UI text goes through Lingui**: `t` / `<Trans>` from `@lingui/core/macro`, then `pnpm i18n:extract`.
  Leave room for the Chinese text; don't size labels to the English width.
- **Check it in a browser**: `pnpm dev:web` runs the renderer on a dev core with a copy of the example
  workspace and the fake engine as an agent, at light and dark. Electron doesn't run in most agent
  sandboxes, so leave `pnpm try` for a person.
- **Nothing in `public/` is private**: Vite copies it into every build that ships.
