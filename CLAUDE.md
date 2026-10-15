# owlit

Read `docs/vision.md` before any feature work; `docs/decisions/` has the reasons behind each part and the open questions. UI work follows `DESIGN.md` (tokens in its front matter, rationale in the body): read it before changing any interface, and update it in the same change whenever a style decision changes. It covers how things look, not what they do: a feature's behaviour is described by its code, so keep the reason for any non-obvious behaviour in a comment where it is implemented.

Backend work is organised as tasks in `.agents/tasks/` (read its README first). Don't create docs in this repo unless asked.

Running and building: see `CONTRIBUTING.md`. Claude Code's preview pane cannot host Electron: its `.claude/launch.json` entries run the renderer alone (`pnpm --dir app dev --port <port>`), the same as `pnpm dev:web`.

Feature work happens in a worktree under `.claude/worktrees/` branched from dev. For the user to see a change before it is merged, start `pnpm try` in that worktree in a Terminal tab they can see and stop: it opens Owlit Dev (branch in the name) on a copy of their data, beside the Owlit they use (CONTRIBUTING.md › Running from source). Once it is merged into dev, push dev, then remove that worktree and delete its branch in the same session, so finished ones don't pile up. Releases: `CONTRIBUTING.md` › Releases.
