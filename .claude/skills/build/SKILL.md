---
name: build
description: Build an Agreed work folder: a worktree from dev, small steps written here and the rest by one builder subagent continued step to step, checked by its reports, pnpm check and screenshots once at the end, then /try-it, the examiner when it examined the proposal, and /ship. Use when a work folder's Status says Agreed, or to continue one that is Building.
---

The argument is the work folder and, optionally, which step. Read its README, `AGENTS.md` and the area
files the steps touch.

1. **The worktree.** Without one: `EnterWorktree`, `git reset --hard dev` (the app cuts worktrees from
   `main`), `git checkout -b <slug>`. Add an `owlit-app-<slug>` entry to `.claude/launch.json` (a free
   port, `pnpm --dir <worktree>/app dev`) only when the renderer must be looked at. `Status: Building`.
2. **The steps**, in Work order. Write the `small` ones here. The rest go to one builder, an `Agent`
   (opus) continued with `SendMessage` from step to step, so it keeps what it learned. Its brief: the
   worktree and branch (commit there; never merge, push or `git stash`); `AGENTS.md`, the area's
   `AGENTS.md`, `DESIGN.md` for UI; the step's text and files; English everywhere, comments say why,
   UI text through Lingui with both catalogs filled, `rules.ts` bumps its version, tests poll; a step is
   done when its test files pass and it is committed, with a report of the files changed, what it
   verified, what it couldn't and what it is least sure of.
3. **Check each step by its report**: run its test files, read the parts the report is unsure of and the
   Touches lines that apply. Fix small things yourself; send bigger ones back with the exact failure.
   Tick the step.
4. **After the last step, once:** the builder runs `pnpm check`, shoots every UI state in dev:web (light
   and dark, Chinese when text changed) into the folder's `shots/`, and adds a changelog line if people
   would notice. Look at every shot; write Verification (date, where, shots, what remains for Electron).
5. **`/try-it`** (the builder may run it; read every shot it names), then **`/examine`** (built pass) if
   the proposal was examined. A Stop or Change finding becomes a new Work step or a revisit line in
   Settled.
6. **`/ship`.**

What only Electron shows is tried in Owlit Dev, with a real engine when the step is about Owlit's answers.
