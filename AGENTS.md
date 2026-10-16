# owlit

A desktop app (Electron, macOS for now) where a researcher and an assistant called Owlit read, write and
think through papers. A workspace is a folder of plain files. This file is for coding agents working on
owlit; people start at [CONTRIBUTING.md](CONTRIBUTING.md), which this file doesn't repeat.

## Commands

Run from the repo root with pnpm (never npm or yarn). Node 24, pnpm 10, macOS on Apple silicon.

```bash
pnpm check                                    # typecheck + lint + test, as CI runs it: must pass before you finish
pnpm exec vitest run packages/core/src/library/import.test.ts   # one test file; prefer this while working
pnpm typecheck                                # all packages
pnpm lint                                     # oxlint; also enforces core's import boundary
pnpm i18n:extract                             # after adding or changing UI text
pnpm dev:web                                  # the renderer alone in a browser, on mock data
pnpm try                                      # the whole app (Owlit Dev) for this checkout, on a copy of the user's data
```

Electron can't run inside most agent sandboxes or preview panes: check UI with `pnpm dev:web` in a browser,
and leave `pnpm try` for a person to open.

## Where things are

- `app/`: the renderer (React, Vite, Tailwind, shadcn). `app/src/features/<place>/` per place in the app;
  shared pieces in `app/src/components/`.
- `apps/desktop/`: the Electron main process, preload and the build scripts.
- `packages/core/`: the backend, plain Node. It never imports Electron or React (lint enforces it).
- `packages/protocol/`: the types between renderer, core and clients.
- `packages/owlit-mcp/`, `packages/cli/`, `packages/client/`: owlit's tools for agents, and the `owlit`
  command.
- `packages/owlit-agent/`: owlit's own agent (the Owlit engine).

## Rules

- **English everywhere in code**: identifiers, comments, UI text, commit messages. The app is translated
  through Lingui: UI text goes through `t` / `<Trans>` (`@lingui/core/macro`), then `pnpm i18n:extract`.
  Text meant for agents (prompts, tool descriptions) is never translated.
- **Names**: the app is "owlit" (lowercase); the assistant inside it is "Owlit". The UI never names an
  engine (Claude Code, Codex) except where the user picks one.
- **The code describes what it does.** Put the reason for anything non-obvious in a comment where it is
  implemented, not in a doc. Don't add docs or Markdown files unless asked.
- **UI changes follow [DESIGN.md](DESIGN.md)**: read it first, use its tokens, and update it in the same
  change when a style rule changes. It says how things look, not what they do.
- **shadcn (radix-nova)**: copy the official component or block markup; don't approximate it by hand.

## Traps we have hit

- **Tests must not depend on timing.** On macOS a just-started recursive `fs.watch` can miss a write made
  in its first moments: poll with `vi.waitFor` and write again, never sleep a fixed time. Don't assert
  wall-clock limits ("< 200ms"); check order instead.
- **A flaky core test is usually a real race.** Reproduce it with forced delays before changing the test.
  Writes into a paper's folder check `ctx.signal` first and use `writeFileAtomic(…, { parents: false })`,
  so a task that outlives a move or delete can't bring the old folder back (see `paperDir` in
  `packages/core/src/library/paths.ts`).
- **Nothing in `app/public/` is private**: Vite copies it into every build that ships.

## Commits and branches

Branch from `dev`, merge back into `dev`; `main` only moves at a release. The rest (subject lines, commit
size, changelog lines) is in [CONTRIBUTING.md › Commits and branches](CONTRIBUTING.md#commits-and-branches).
Before you call a change done: `pnpm check` passes, and if people would notice it, there is a line under
`## Unreleased` in `apps/desktop/CHANGELOG.md`.
