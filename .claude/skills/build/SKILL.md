---
name: build
description: Build an Agreed work folder one Work step at a time: a worktree from dev, a build subagent per step with a fixed brief, the diff read and checked here, Verification written, then /try-it, the examiner on the build, and /ship. Use when a work folder's Status says Agreed, or to continue one that is Building.
---

The argument is the work folder and, optionally, which step. Read its README (Settled, Touches, Work,
Verification), `AGENTS.md` and the area files the steps touch.

1. **The worktree.** Without one: `EnterWorktree`, then `git reset --hard dev` (the app cuts worktrees
   from `main`) and `git checkout -b <slug>`. With one already on dev's tip: branch there. Add an
   `owlit-app-<slug>` entry to `.claude/launch.json` (a free port, `pnpm --dir <worktree>/app dev`) only
   when the renderer must be looked at. `Status: Building`, naming the branch.
2. **One step at a time**, in Work order:
   a. **An `Agent` (model opus)** with this brief: the repo and worktree paths; the branch (commit there;
      never merge, push or `git stash`); read `AGENTS.md`, the area's `AGENTS.md`, `DESIGN.md` for UI;
      the step's text from the README and the files it names; the rules that trip builders (English
      everywhere; comments say why, never when; UI text through Lingui and both catalogs filled;
      `rules.ts` bumps its version; tests poll, never sleep); what done means: `pnpm check` passes, a
      changelog line if people would notice, a screenshot of every UI state in dev:web (light and dark,
      Chinese when text changed) under the folder's `shots/`, and a report naming the files changed,
      what it verified and what it couldn't.
   b. **Review here, not by trust.** Read the whole diff (`git diff dev...HEAD`), run the step's test
      files, open dev:web and look at what the report says it couldn't verify and at the Touches lines
      that apply. Fix small things yourself in the worktree; send bigger ones back to the same agent
      (`SendMessage`) with the exact failure.
   c. **Verification** in the README: the date, what was tried where, the shots' paths, what remains for
      Electron. Tick the step in Work.
3. **After the last step**: `/try-it` for the Electron items (an `Agent` (opus) may run it; read every
   screenshot it names). Then `/examine` (built pass). A Stop or Change finding becomes a new Work step
   back at 2, or a revisit line in Settled; it is never left standing.
4. **`/ship`.**

A step is not done because dev:web showed it: what only Electron shows is tried in Owlit Dev, with a real
engine when the step is about Owlit's answers.
