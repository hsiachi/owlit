# owlit

A pnpm workspace: `app/` is the renderer (React + Vite), `packages/protocol/` the wire types,
`packages/core/` the backend (plain Node, never imports Electron or React), `apps/desktop/` the
Electron shell that wires them together, `packages/client/` a Node client for a running owlit, and
`packages/owlit-mcp/` the MCP server that gives agents owlit's library, docs and chats.

```bash
pnpm install
pnpm dev          # Electron window, renderer from Vite with HMR; main/preload rebuild restarts Electron
pnpm dev:web      # the renderer alone in a browser, on mock data
pnpm build        # unsigned apps/desktop/release/mac-arm64/owlit.app
pnpm test         # vitest across packages/*
pnpm lint         # oxlint everywhere; also enforces core/protocol's import boundary
pnpm typecheck
```

`pnpm dev -- --remote-debugging-port=9333` passes flags through to Electron. `OWLIT_USER_DATA=<dir>`
points the app data directory (settings, per-workspace data, the single-instance lock) somewhere
other than `~/Library/Application Support/owlit`, e.g. to try a first launch. `OWLIT_LOG_ACTIVITY=1`
prints every activity event the renderer reports; `OWLIT_LOG_DOCS=1` prints what the workspace watcher reports.

The build tooling is Vite (renderer) plus esbuild (main and preload, bundled with core) driven by
`apps/desktop/scripts/`; electron-vite does not support Vite 8 yet. Behind an HTTP proxy, Electron's
binary download needs `NODE_USE_ENV_PROXY=1 pnpm install`.

Claude Code's preview pane cannot host Electron: its `.claude/launch.json` entries run the renderer
alone (`pnpm --dir app dev --port <port>`), the same as `pnpm dev:web`.

## owlit's tools in an agent outside owlit

owlit hands owlit-mcp to the agents it runs. Any other MCP client can use it too, while owlit has the
workspace open (it talks to owlit over the workspace's socket). For Claude Code, in this repo:

```bash
claude mcp add owlit -- node "$PWD/packages/owlit-mcp/src/main.ts" --workspace ~/Research
```

`--workspace` is the folder open in owlit. With owlit closed, every tool answers that owlit isn't open.
