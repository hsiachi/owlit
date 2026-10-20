---
name: try-it
description: Try a change in Owlit Dev (Electron) from the command line and record what was seen. Use for every Verification item that only Electron can show: a restart, a real engine, a hidden chat, the app's own windows.
---

The harness is `scripts/drive.mjs` (`pnpm drive`): read its header first, it says how each command works
and the traps it handles.

1. `pnpm drive start` (with the sandbox off: Electron can't start inside it; `--fresh` for clean data,
   `--engine claude` when a step needs a model, `--slow 8000` to catch the fake engine mid-digest).
2. Drive the feature one command at a time: `look` / `find` for ids, `click`, `type`, `key`, `go`,
   `rpc`, `wait text …`, `shot`. `restart` quits and relaunches on the same data for persistence checks.
3. Read every screenshot you take. Write what you saw (and didn't) into the work folder's Verification
   with the engine used and the screenshot paths; a bug in the feature is reported there, not fixed in
   passing.
4. `pnpm drive stop` when done.
