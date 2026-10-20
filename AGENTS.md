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

CONTRIBUTING.md has the full layout, the environment variables and how releases work.

## Rules

- **English everywhere in code**: identifiers, comments, UI text, commit messages. UI text is translated
  (see `app/AGENTS.md`); text meant for agents (prompts, tool descriptions) is never translated.
- **Names**: the app is "owlit" (lowercase); the assistant inside it is "Owlit". The UI never names an
  engine (Claude Code, Codex) except where the user picks one.
- **The code describes what it does.** Put the reason for anything non-obvious in a comment where it is
  implemented, not in a doc. Don't add docs or Markdown files unless asked.
- **Comments.** An export gets a one-line contract when its name doesn't say it. Inside a function, comment
  only what the code can't say: why, what breaks if it changes, invariants and ordering, an upstream or
  platform workaround (name the cause), "change X with Y", why a constant has its value. No dates, no
  "before / now / used to / no longer / fixed", no counts from one run, no pointers outside the repo, no
  product specs: the story of a change goes in the commit message. Name an agent or adapter version only
  when behaviour depends on it. A reason that needs a long paragraph splits onto the branches it explains,
  or the code should change. No TODOs.
- **Write for someone who never saw the session.** Before finishing, reread every comment, commit message
  and changelog line you wrote as a person who has only the repo: no "as discussed", no discarded
  alternatives, no account of how you got there.
- **Each area has its own rules**: read `app/AGENTS.md` before changing the renderer and
  `packages/core/AGENTS.md` before changing core.
- **This file stays short.** A new rule or trap goes in only if it isn't obvious from the code, was hit
  more than once, and says exactly what to do. One that holds in one area goes in that area's file.

## Traps we have hit

- **Tests must not depend on timing.** Poll with `vi.waitFor` instead of sleeping a fixed time, and check
  order instead of wall-clock limits ("< 200ms"). Core has the details.

## Commits and branches

Branch from `dev`, merge back into `dev`; `main` only moves at a release. The rest (subject lines, commit
size, changelog lines) is in [CONTRIBUTING.md › Commits and branches](CONTRIBUTING.md#commits-and-branches).
Before you call a change done: `pnpm check` passes, and if people would notice it, there is a line under
`## Unreleased` in `apps/desktop/CHANGELOG.md`. What only Electron can show (a restart, a real engine, the
app's own windows) is tried in Owlit Dev by you or by a session you start (`/try-it`), never left for a
person to try later. `/ship` runs the whole list.
