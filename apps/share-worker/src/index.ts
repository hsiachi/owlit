import { BODY_LIMITS, checkNewShare, hashToken, HttpFailure, newId, PAGE_HEADERS, RATES, SHARE_ID } from "@owlit/share-server/rules"
import { json, readJson } from "./http.ts"
import { Limiter } from "./limiter.ts"
import { ShareRoom } from "./room.ts"

// The share server on Cloudflare: the same API as apps/share-server, with a ShareRoom per shared doc. The
// worker makes shares and hands every other request about one to its room; the reader's page is static
// (apps/share-web), served at /s/<id> with its security headers.

export { Limiter, ShareRoom }

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const [, , kind, id] = url.pathname.split("/")
  if (kind !== "shares") throw new HttpFailure(404, "Not found.")
  if (!id) {
    if (request.method !== "POST") throw new HttpFailure(405, "Method not allowed.")
    const address = request.headers.get("cf-connecting-ip") ?? "?"
    const { count, windowMs } = RATES.create
    if (!(await env.LIMITS.get(env.LIMITS.idFromName(address)).allow(count, windowMs))) throw new HttpFailure(429, "Too many requests from here; try again a little later.")
    const { bundle, permission } = checkNewShare(await readJson(request, BODY_LIMITS.share))
    const shareId = newId(16)
    const token = newId(32)
    await env.ROOMS.get(env.ROOMS.idFromName(shareId)).create({ id: shareId, tokenHash: await hashToken(token), bundle, permission, now: Date.now() })
    return json(201, { id: shareId, token, url: `${url.origin}/s/${shareId}` })
  }
  if (!SHARE_ID.test(id)) throw new HttpFailure(404, "There is no share at this link.")
  return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(request)
}

// The reader's one page, with what keeps it to itself
async function page(request: Request, env: Env, url: URL): Promise<Response> {
  const index = await env.ASSETS.fetch(new Request(new URL("/", url), { headers: request.headers }))
  const res = new Response(index.body, index)
  for (const [name, value] of Object.entries(PAGE_HEADERS)) res.headers.set(name, value)
  res.headers.set("cache-control", "no-cache")
  return res
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (url.pathname === "/healthz") return json(200, { ok: true })
      if (url.pathname.startsWith("/api/")) return await api(request, env, url)
      if (/^\/s\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return await page(request, env, url)
      return env.ASSETS.fetch(request)
    } catch (error) {
      if (error instanceof HttpFailure) return json(error.status, { error: error.message })
      console.error("[share] request failed", error)
      return json(500, { error: "Something went wrong on the server." })
    }
  },
} satisfies ExportedHandler<Env>
