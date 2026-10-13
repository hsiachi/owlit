import { t } from "@lingui/core/macro"
import type { ShareBundle, ShareComment, SharePermission } from "@owlit/protocol"

// Talks to the share server (apps/share-server) through the host's fetch, so the system's proxy applies.
// Every failure is a ShareError with a sentence for the window.

export class ShareError extends Error {
  // 0: the server couldn't be reached
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ShareError"
    this.status = status
  }
  // The server holds this share no more (stopped, from here or elsewhere)
  get gone() {
    return this.status === 404 || this.status === 410
  }
}

const TIMEOUT_MS = 20_000

export class ShareClient {
  private readonly fetch: typeof fetch
  readonly server: string

  constructor(server: string, fetchFn: typeof fetch = globalThis.fetch) {
    this.server = server.replace(/\/+$/, "")
    this.fetch = fetchFn
  }

  create(bundle: ShareBundle, permission: SharePermission) {
    return this.call<{ id: string; token: string; url: string }>("POST", "/api/shares", { bundle, permission })
  }

  update(id: string, token: string, change: { bundle?: ShareBundle; permission?: SharePermission }) {
    return this.call<{ updatedAt: number }>("PUT", `/api/shares/${id}`, change, token)
  }

  stop(id: string, token: string) {
    return this.call<null>("DELETE", `/api/shares/${id}`, undefined, token)
  }

  comments(id: string, token?: string) {
    return this.call<ShareComment[]>("GET", `/api/shares/${id}/comments`, undefined, token)
  }

  reply(id: string, token: string, reply: { parent: string; name: string; text: string }) {
    return this.call<ShareComment>("POST", `/api/shares/${id}/comments`, reply, token)
  }

  resolve(id: string, token: string, commentId: string, resolved: boolean) {
    return this.call<null>("PATCH", `/api/shares/${id}/comments/${commentId}`, { resolved }, token)
  }

  private async call<T>(method: string, route: string, body?: unknown, token?: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetch(this.server + route, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      const host = hostOf(this.server)
      throw new ShareError(0, t`Couldn't reach the share server (${host}).`)
    }
    if (response.status === 204) return null as T
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    if (response.ok) return data as T
    if (response.status === 410) throw new ShareError(410, t`The link was stopped.`)
    if (response.status === 404) throw new ShareError(404, t`The share server no longer has this link.`)
    if (response.status === 403) throw new ShareError(403, t`The share server refused: this computer doesn't hold the link's key.`)
    if (response.status === 413) throw new ShareError(413, t`The doc and its papers are too large to share.`)
    if (response.status === 429) throw new ShareError(429, t`The share server is asking owlit to slow down.`)
    const status = response.status
    throw new ShareError(status, data?.error ? t`The share server answered: ${data.error}` : t`The share server answered ${status}.`)
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
