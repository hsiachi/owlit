# Contributing to owlit

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on
the shape before you write it. UI changes follow [DESIGN.md](DESIGN.md) (tokens in its front matter, the
reasons in the body); if a change alters a style decision, update DESIGN.md in the same change.

By contributing you agree that your contribution is licensed under the project's
[AGPL-3.0-or-later](LICENSE).

## Running from source

Needs macOS (Apple silicon), Node 24 and pnpm 10.

```bash
pnpm install
pnpm dev          # Owlit Dev: renderer from Vite with HMR; main/preload rebuild restarts it
pnpm try          # pnpm dev in a fresh worktree: installs packages and Electron first
pnpm dev:web      # the renderer alone in a browser, on mock data
pnpm build        # unsigned apps/desktop/release/mac-arm64/Owlit.app
pnpm app:install  # build this checkout into /Applications as the Owlit you use
pnpm check        # typecheck, lint and test, as CI runs it
```

To use owlit while working on it, keep the two apart. The Owlit you use is the one `pnpm app:install` puts in
`/Applications`, on your real data; it changes only when you run that again (from dev), so merging never
restarts it. It is signed and shares links as a release does when `.env.release.local` says how (see
Releases). `pnpm dev` and `pnpm try` open **Owlit Dev** instead: a graphite icon, the branch in its name
(`Owlit Dev (show-in-paper)`), and its own copy of your data, so several can run beside Owlit and each other.
The copy is taken the first time a checkout runs (`~/Library/Application Support/Owlit Previews/`): your app
data and the workspaces in it, cloned on APFS so it costs no disk space until either side changes, without
the work your Owlit had not finished. Nothing in a preview reaches your real folders. `pnpm dev -- --fresh`
takes the copy again; a preview whose checkout is gone is removed at the next run.

`pnpm test`, `pnpm lint` (oxlint everywhere; also enforces core/protocol's import boundary) and
`pnpm typecheck` run the parts of `pnpm check` alone. `pnpm i18n:extract` updates the message catalogs in
`packages/i18n/locales/` after changing UI text.

Behind an HTTP proxy, Electron's binary download needs `NODE_USE_ENV_PROXY=1 pnpm install`.
`pnpm dev -- --remote-debugging-port=9333` passes flags through to Electron.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | The renderer: React + Vite |
| `apps/desktop/` | The Electron shell that wires the rest together, and the build scripts |
| `packages/protocol/` | The wire types between renderer, core and clients |
| `packages/core/` | The backend: plain Node, never imports Electron or React |
| `packages/owlit-agent/` | owlit's own agent (the Owlit engine), built on Pi |
| `packages/owlit-mcp/` | The MCP server that gives agents owlit's library, docs and chats |
| `packages/client/`, `packages/cli/` | A Node client for a running owlit, and the `owlit` command built on it |
| `packages/i18n/` | Message catalogs (English, 简体中文) |
| `apps/share-worker/`, `apps/share-server/`, `apps/share-web/` | Sharing a doc by link: the server on Cloudflare or on plain Node, and the reader's page ([notes](apps/share-worker/README.md)) |

The build tooling is Vite (renderer) plus esbuild (main and preload, bundled with core) driven by
`apps/desktop/scripts/`; electron-vite does not support Vite 8 yet.

## Environment variables

| Variable | Effect |
| --- | --- |
| `OWLIT_USER_DATA=<dir>` | Where app data lives (settings, per-workspace data, the single-instance lock) instead of `~/Library/Application Support/owlit`, e.g. to try a first launch; `pnpm dev` then copies nothing |
| `OWLIT_PREVIEW_SOURCE=<dir>` | The app data `pnpm dev` copies for a new preview, instead of the installed Owlit's |
| `OWLIT_SHARE_SERVER=<url>` | The share server links are made on. Baked in at build time, or set for one run; empty or unset means no sharing |
| `OWLIT_LOG_ACTIVITY=1` | Print every activity event the renderer reports |
| `OWLIT_LOG_DOCS=1` | Print what the workspace watcher reports |
| `OWLIT_LOG_AGENTS=1` | Print what agent processes say to owlit |
| `OWLIT_LOG_BROWSER=1` | Print what the embedded publisher view does |

## Releases

A release is an arm64 dmg, signed with a self-signed certificate so macOS keeps a user's Keychain and folder
grants across versions; it isn't notarised. It is built on the maintainer's Mac, where the certificate
lives. `main` is the latest release: it only moves when one goes out, and pushing it deploys the share
server (`.github/workflows/share-worker.yml`).

1. Add a `## <version>` section to `apps/desktop/CHANGELOG.md` on dev and commit it.
2. `pnpm release:ship <version>` from the checkout of dev. It bumps the version, runs `pnpm check`, builds
   and signs the dmg with `Owlit <version> - read me first.txt` (install steps plus the changelog section),
   then moves `main` up to dev, tags `v<version>`, pushes, and makes the GitHub release. Nothing leaves the
   Mac until the checks and the build have passed.

`pnpm release` alone builds the dmg and the read-me in `apps/desktop/release/` without publishing.

`pnpm release` reads `.env.release.local` at the repo root (ignored by git), and the environment wins over
it, so CI can set the same values later:

```bash
OWLIT_SHARE_SERVER=https://share.example.org   # required: the share server links are made on; empty for none
OWLIT_SIGN_IDENTITY="Owlit Self-Signed"        # the certificate in the login keychain; without it, ad hoc
OWLIT_RELEASE_ARCHIVE=/Users/me/releases        # optional: release:ship copies each dmg and read-me here
```
