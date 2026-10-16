# packages/core

The backend: plain Node, shared by the desktop app, the CLI and the MCP server.

- **No Electron, no React.** Core never imports either; `.oxlintrc.json` here fails the lint if it does.
  Anything that needs the window or the OS goes through `Host` (`src/host.ts`), which the desktop app
  implements.
- **Writes into a paper's folder** check `ctx.signal` first and use `writeFileAtomic(…, { parents: false })`,
  so a task that outlives a move or delete can't bring the old folder back (see `paperDir` in
  `src/library/paths.ts`).
- **Tests must not depend on timing.** On macOS a just-started recursive `fs.watch` can miss a write made in
  its first moments: poll with `vi.waitFor` and write again, never sleep a fixed time. Don't assert
  wall-clock limits; check order instead.
- **A flaky test is usually a real race.** Reproduce it with forced delays before changing the test.
- **Text for agents** (prompts, tool descriptions, `src/agents/rules.ts`) is English and never goes through
  Lingui. Changing the rules text means bumping its version as `rules.ts` says.

Run one file while working: `pnpm exec vitest run packages/core/src/<path>.test.ts`.
