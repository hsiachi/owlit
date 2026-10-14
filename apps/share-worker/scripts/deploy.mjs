// pnpm --filter @owlit/share-worker deploy: builds the reader's page, then deploys the worker with it.
//
// The address it is reached by is not in wrangler.jsonc, so a fork deploys to its own workers.dev address
// rather than someone else's domain. The maintainer's comes from OWLIT_SHARE_SERVER, the same value a
// release bakes into the app (.env.release.local at the repo root, or the environment), and is deployed as a
// custom domain. Without it the worker is deployed to workers.dev only; a custom domain made by an earlier
// deploy stays, since wrangler only touches the domains it is given.

import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

try {
  process.loadEnvFile(path.join(workerDir, "../../.env.release.local"))
} catch (error) {
  if (error.code !== "ENOENT") throw error
}
const server = process.env.OWLIT_SHARE_SERVER
const domain = server ? new URL(server).hostname : undefined

execFileSync("pnpm", ["--filter", "@owlit/share-web", "build"], { cwd: workerDir, stdio: "inherit" })
execFileSync("pnpm", ["exec", "wrangler", "deploy", ...(domain ? ["--domain", domain] : [])], { cwd: workerDir, stdio: "inherit" })
