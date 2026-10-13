# owlit

A pnpm workspace: `app/` is the renderer (React + Vite), `packages/protocol/` the wire types,
`packages/core/` the backend (plain Node, never imports Electron or React), `apps/desktop/` the
Electron shell that wires them together, `packages/client/` a Node client for a running owlit, and
`packages/owlit-mcp/` the MCP server that gives agents owlit's library, docs and chats. `apps/share-server/` and
`apps/share-web/` are the server and the browser page behind sharing a doc by link.

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

## Sharing docs by link

A doc's Share button makes a link anyone can open in a browser, without owlit: they read the doc and the
papers it cites (Owlit's digests, and the author's notes if allowed) and comment; comments come back into the
doc. owlit pushes every change as it is made. The server keeps only what readers see and their comments, in one
SQLite file; PDFs never go there, and the key that changes a link stays on the computer that made it.

Locally, run the server with the built page, then owlit pointed at it:

```bash
pnpm --filter @owlit/share-web build
STATIC_DIR=apps/share-web/dist node apps/share-server/src/main.ts      # http://localhost:8787
OWLIT_SHARE_SERVER=http://localhost:8787 pnpm dev
```

`pnpm --filter @owlit/share-web dev` serves the page with HMR against that server. To put the server on a machine
you can ssh into (Node 22.13+, sudo for the systemd service):

```bash
apps/share-server/deploy/deploy.sh algernon https://share.example.org   # behind Caddy: apps/share-server/deploy/Caddyfile
apps/share-server/deploy/deploy.sh algernon http://<ip>:8787             # no proxy, unencrypted: only to try it
OWLIT_SHARE_SERVER=https://share.example.org pnpm build                  # bakes the server into the app
```

