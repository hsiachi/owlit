import { SHARE_LIMITS, type ShareAnchor, type ShareBundle, type SharePermission } from "@owlit/protocol"

// What every share server checks, the same way: the Node server here and the Cloudflare worker
// (apps/share-worker). Only web-standard APIs (Web Crypto), so it runs on both.

export class HttpFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const COMMENTS_PER_SHARE = 2000
// Requests per address in a window: making shares, posting comments
export const RATES = {
  create: { count: 30, windowMs: 60 * 60_000 },
  comment: { count: 40, windowMs: 10 * 60_000 },
} as const
export const SHARE_ID = /^[A-Za-z0-9_-]{16,64}$/
// What a body may weigh: a share's bundle with room for its envelope, a comment, a resolve
export const BODY_LIMITS = { share: SHARE_LIMITS.bundle + 1024, comment: 64 * 1024, small: 1024 } as const

// The reader's page loads only from its own server; images in a doc may come from the web. A link out never
// says where it came from, so the share's address doesn't travel in Referer.
export const PAGE_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

// bytes random bytes, base64url: share ids (16), keys (32), comment ids (9)
export function newId(bytes: number) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// A key as the server keeps it: SHA-256, hex
export async function hashToken(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Whether a request carries the key whose hash is kept, compared in constant time
export async function carriesKey(authorization: string | null | undefined, tokenHash: string) {
  const token = /^Bearer (.+)$/.exec(authorization ?? "")?.[1]
  if (!token) return false
  const a = await hashToken(token)
  if (a.length !== tokenHash.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ tokenHash.charCodeAt(i)
  return diff === 0
}

export function checkBundle(value: unknown): ShareBundle {
  if (!isRecord(value) || value.version !== 1 || typeof value.title !== "string" || typeof value.markdown !== "string" || !isRecord(value.papers)) {
    throw new HttpFailure(400, "The bundle isn't one this server reads.")
  }
  for (const paper of Object.values(value.papers)) {
    if (!isRecord(paper) || typeof paper.id !== "string" || typeof paper.title !== "string" || !Array.isArray(paper.authors)) {
      throw new HttpFailure(400, "A paper in the bundle isn't one this server reads.")
    }
  }
  return value as unknown as ShareBundle
}

export const checkPermission = (value: unknown): SharePermission => {
  if (value === "comment" || value === "view") return value
  throw new HttpFailure(400, "permission is comment or view.")
}

export function checkAnchor(value: unknown): ShareAnchor | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.quote !== "string" || typeof value.prefix !== "string" || typeof value.suffix !== "string") {
    throw new HttpFailure(400, "The comment's passage isn't one this server reads.")
  }
  if (!value.quote.trim() || value.quote.length > SHARE_LIMITS.quote) throw new HttpFailure(400, "The passage is empty or too long.")
  return { quote: value.quote, prefix: value.prefix.slice(-64), suffix: value.suffix.slice(0, 64) }
}

// A new share's body: its bundle and who may comment
export function checkNewShare(body: unknown) {
  if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
  return { bundle: checkBundle(body.bundle), permission: body.permission === undefined ? ("comment" as const) : checkPermission(body.permission) }
}

// The author's change to a share: a new bundle, who may comment, or both
export function checkChange(body: unknown) {
  if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
  return {
    ...(body.bundle !== undefined ? { bundle: checkBundle(body.bundle) } : {}),
    ...(body.permission !== undefined ? { permission: checkPermission(body.permission) } : {}),
  }
}

// A comment's body: on a passage (anchor) or an answer to another comment (parent), signed with a name
export function checkComment(body: unknown): { text: string; name: string; parent?: string; anchor: ShareAnchor | null } {
  if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
  const text = typeof body.text === "string" ? body.text.trim() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!text || text.length > SHARE_LIMITS.comment) throw new HttpFailure(400, "The comment is empty or too long.")
  if (!name || name.length > SHARE_LIMITS.name) throw new HttpFailure(400, "Say who you are, in a short name.")
  if (typeof body.parent === "string" && body.parent) return { text, name, parent: body.parent, anchor: null }
  const anchor = checkAnchor(body.anchor)
  if (!anchor) throw new HttpFailure(400, "A comment is on a passage or answers another comment.")
  return { text, name, anchor }
}

export function checkResolve(body: unknown) {
  if (!isRecord(body) || typeof body.resolved !== "boolean") throw new HttpFailure(400, "resolved is true or false.")
  return body.resolved
}

// A sliding window per key: true while under the rate
export function underRate(hits: Map<string, number[]>, key: string, rate: { count: number; windowMs: number }, now: number) {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < rate.windowMs)
  if (recent.length >= rate.count) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}
