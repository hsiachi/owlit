---
name: ship
description: Finish a branch the owlit way: checks, changelog, i18n, CI, merge into dev, push, worktree removed. Use when a piece of work is done and should land on dev.
---

Run from the worktree of the branch to ship. Stop and say so at the first step that fails; never skip one.

1. The branch comes from `dev`: `git merge-base --is-ancestor dev HEAD` must succeed. If dev moved on,
   rebase onto dev (`git rebase dev`) rather than merging dev in.
2. Rename a generated branch name to a short slug of what it does (`git branch -m <slug>`).
3. `pnpm check`. A test that times out under load is rerun once before it counts as broken.
4. UI text changed: `pnpm i18n:extract`, and both catalogs in `packages/i18n/locales/` have the new
   entries (the Chinese one translated, not left empty). Rules text in `rules.ts` changed: `rules.test.ts`
   says how to bump its version.
5. If people would notice the change, a line under `## Unreleased` in `apps/desktop/CHANGELOG.md`, in the
   words a user would use.
6. The work folder in `local/work/`, if there is one: Verification has no Electron item still "Not tried"
   that `/try-it` could run; Status says Done with the merge commit once merged.
7. dev's latest CI run is green: `gh run list -b dev -L 1`. Red means fixing dev comes first.
8. Merge: from the main checkout, `git merge --no-ff <branch> -m "Merge branch '<branch>' into dev: <outcome>"`,
   the body carrying the short what and why from the work folder's Settled. Then `git push origin dev`.
9. Remove the worktree and delete the branch: `git worktree remove .claude/worktrees/<name>` and
   `git branch -d <branch>`. Move a finished work folder to `local/archive/`.

Merging into dev doesn't touch the Owlit hsiachi uses (`pnpm app:install` keeps it apart), but it
restarts any `pnpm dev` Owlit Dev running on the main checkout: say so in the report.
