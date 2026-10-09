# owlit

A pnpm workspace: `app/` is the renderer (React + Vite), `packages/protocol/` the wire types,
`packages/core/` the backend (plain Node, never imports Electron or React), `apps/desktop/` the
Electron shell that wires them together.

```bash
pnpm install
pnpm dev          # Electron window, renderer from Vite with HMR; main/preload rebuild restarts Electron
pnpm dev:web      # the renderer alone in a browser, on mock data
pnpm build        # unsigned apps/desktop/release/mac-arm64/owlit.app
pnpm test         # vitest across packages/*
pnpm lint         # oxlint everywhere; also enforces core/protocol's import boundary
pnpm typecheck
```

`pnpm dev -- --remote-debugging-port=9333` passes flags through to Electron.

The build tooling is Vite (renderer) plus esbuild (main and preload, bundled with core) driven by
`apps/desktop/scripts/`; electron-vite does not support Vite 8 yet. Behind an HTTP proxy, Electron's
binary download needs `NODE_USE_ENV_PROXY=1 pnpm install`.

Claude Code's preview pane cannot host Electron: its `.claude/launch.json` entries run the renderer
alone (`pnpm --dir app dev --port <port>`), the same as `pnpm dev:web`.
