# The share server

A doc's Share button makes a link anyone can open in a browser, without owlit: they read the doc and the
papers it cites (Owlit's digests, and the author's notes if allowed) and comment; comments come back into the
doc. owlit pushes every change as it is made. The server keeps only what readers see and their comments; PDFs
never go there, and the key that changes a link stays on the computer that made it.

There are two servers with the same API, and both pass the same tests (`apps/share-server/src/contract.ts`):

- **`apps/share-worker`** (here): Cloudflare. A Worker, one Durable Object per shared doc, readers' pages kept
  live over hibernating WebSockets, so an open page costs nothing while nothing changes. The free plan is
  plenty.
- **`apps/share-server`**: plain Node with one SQLite file, for a machine of your own.

Both serve the reader's page from `apps/share-web`. An app makes links on the server named by
`OWLIT_SHARE_SERVER` when it was built (or when it runs); without one, the Share dialog says no share server
is set up.

## On Cloudflare

Once, with a Cloudflare account:

```bash
pnpm --filter @owlit/share-worker exec wrangler login
pnpm --filter @owlit/share-worker run deploy       # builds the reader's page, deploys both, prints its workers.dev address
```

`workers.dev` isn't reliably reachable from mainland China, so for real use give it a domain of your own (a
zone on the same Cloudflare account). Put the address in `.env.release.local` at the repo root (ignored by
git), and deploy again; the deploy makes it the worker's custom domain:

```bash
OWLIT_SHARE_SERVER=https://share.example.org
```

The same line is what `pnpm release` bakes into the app (see [CONTRIBUTING.md](../../CONTRIBUTING.md)). For
a one-off build, set it in the environment instead: `OWLIT_SHARE_SERVER=https://share.example.org pnpm build`.

Locally, `pnpm --filter @owlit/share-worker dev` runs the same worker in workerd at http://localhost:8787,
and `OWLIT_SHARE_SERVER=http://localhost:8787 pnpm dev` points owlit at it.

## On a machine of your own

`apps/share-server` needs Node 22.13 or later, and sudo for the systemd service. `deploy.sh` builds it, copies
it over ssh and starts it; behind Caddy, use `apps/share-server/deploy/Caddyfile`:

```bash
apps/share-server/deploy/deploy.sh <ssh-host> https://share.example.org
```

Its settings (`PORT`, `PUBLIC_URL`, `DATA_DIR` and others) are listed at the top of
`apps/share-server/src/main.ts`.
