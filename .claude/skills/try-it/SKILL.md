---
name: try-it
description: Run a work folder's Electron-only Verification items in Owlit Dev from the command line and write the results back. Use whenever Verification says "Not tried in Electron" or "with a real engine", before Status says Done.
---

Given a work folder `local/work/<date>-<slug>/`:

1. Read its README's Verification and list every item that only Electron can show (a restart, a real
   engine, a hidden chat, the app's own windows, a quit in the middle) still marked not tried.
2. Start Owlit Dev with the harness, `pnpm drive start` (`scripts/drive.mjs`; its header is the manual:
   read it first). The sandbox must be off for `start` and `restart`. `--fresh` for clean data, `--mine`
   for a clone of hsiachi's data and workspace (never the real folders), `--engine claude` for items that
   need a model, `--slow 8000` to catch the fake engine mid-digest.
3. Run each item one command at a time (`look`/`find` for ids, `click`, `type`, `key`, `go`, `rpc`,
   `paste`, `wait text …`, `shot`; `restart` for persistence), and read every screenshot you take.
4. Write what you saw, and didn't, into the README's Verification: the date, the engine used, and the
   screenshot's path for each item, with the screenshots copied into the folder's `shots/`. A bug in the
   feature is reported there, not fixed in passing. An item the harness can run is never left "for
   hsiachi"; only what it truly can't (a native dialog, a sign-in) is, and it says why.
5. `pnpm drive stop`.
