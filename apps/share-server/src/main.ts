import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { createShareServer } from "./server.ts"
import { Store } from "./store.ts"

// Runs the share server from the environment:
//   PORT (8787), HOST (127.0.0.1: behind a reverse proxy that holds the certificate),
//   PUBLIC_URL (where links point, e.g. https://share.example.org), DATA_DIR (./data: the SQLite file),
//   STATIC_DIR (the reader's page, apps/share-web/dist), TRUST_PROXY=1 (take addresses from X-Forwarded-For)
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? "127.0.0.1"
const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "")
const dataDir = path.resolve(process.env.DATA_DIR ?? "data")
const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : undefined

mkdirSync(dataDir, { recursive: true })
const store = new Store(path.join(dataDir, "share.db"))
const share = createShareServer({ store, publicUrl, staticDir, trustProxy: process.env.TRUST_PROXY === "1" })
const server = createServer((req, res) => void share.handler(req, res))
server.listen(port, host, () => console.log(`[share] listening on ${host}:${port}, links at ${publicUrl}/s/<id>`))

const stop = () => {
  share.close()
  server.close(() => {
    store.close()
    process.exit(0)
  })
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
