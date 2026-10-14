import { t } from "@lingui/core/macro"
import type { ShareAnchor, ShareComment, ShareView } from "@owlit/protocol"

// The share server's reader side: the share, its comments, and a stream that says when either changed

export type Loaded = { kind: "ok"; view: ShareView } | { kind: "missing" } | { kind: "stopped" } | { kind: "offline" }

export async function loadShare(id: string): Promise<Loaded> {
  try {
    const res = await fetch(`/api/shares/${encodeURIComponent(id)}`, { cache: "no-store" })
    if (res.status === 404) return { kind: "missing" }
    if (res.status === 410) return { kind: "stopped" }
    if (!res.ok) return { kind: "offline" }
    return { kind: "ok", view: (await res.json()) as ShareView }
  } catch {
    return { kind: "offline" }
  }
}

export async function loadComments(id: string): Promise<ShareComment[] | null> {
  try {
    const res = await fetch(`/api/shares/${encodeURIComponent(id)}/comments`, { cache: "no-store" })
    return res.ok ? ((await res.json()) as ShareComment[]) : null
  } catch {
    return null
  }
}

export async function postComment(id: string, body: { anchor?: ShareAnchor; parent?: string; name: string; text: string }): Promise<ShareComment> {
  let res: Response
  try {
    res = await fetch(`/api/shares/${encodeURIComponent(id)}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  } catch {
    throw new Error(t`Couldn't reach the server. Check your connection and try again.`)
  }
  if (res.ok) return (await res.json()) as ShareComment
  if (res.status === 403) throw new Error(t`This doc can be read but not commented on.`)
  if (res.status === 410) throw new Error(t`The author stopped sharing this doc.`)
  if (res.status === 429) throw new Error(t`Too many comments in a short while. Try again in a few minutes.`)
  throw new Error(t`The comment couldn't be saved. Try again.`)
}

interface Listeners {
  update: () => void
  comments: () => void
  stopped: () => void
}

// Calls back when the share changes, its comments change, or it stops, over the channel the server named:
// a WebSocket (the Cloudflare worker) or server-sent events (the Node server). After a dropped connection
// comes back, whatever changed meanwhile is fetched once.
export function follow(id: string, live: "socket" | "events", on: Listeners) {
  return live === "socket" ? followSocket(id, on) : followEvents(id, on)
}

function followEvents(id: string, on: Listeners) {
  if (typeof EventSource === "undefined") return () => {}
  const source = new EventSource(`/api/shares/${encodeURIComponent(id)}/events`)
  let opened = false
  source.addEventListener("open", () => {
    if (opened) {
      on.update()
      on.comments()
    }
    opened = true
  })
  source.addEventListener("update", on.update)
  source.addEventListener("comments", on.comments)
  source.addEventListener("stopped", () => {
    source.close()
    on.stopped()
  })
  return () => source.close()
}

// Kept alive with a ping the server answers without waking up; opened again, a little later each time,
// when it drops
const PING_MS = 30_000
function followSocket(id: string, on: Listeners) {
  let socket: WebSocket | null = null
  let ping: ReturnType<typeof setInterval> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let wait = 1000
  let opened = false
  let done = false
  const connect = () => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/shares/${encodeURIComponent(id)}/socket`
    socket = new WebSocket(url)
    socket.addEventListener("open", () => {
      wait = 1000
      if (opened) {
        on.update()
        on.comments()
      }
      opened = true
      ping = setInterval(() => socket?.send("ping"), PING_MS)
    })
    socket.addEventListener("message", (e) => {
      if (e.data === "pong") return
      const { type } = JSON.parse(String(e.data)) as { type: string }
      if (type === "update") on.update()
      else if (type === "comments") on.comments()
      else if (type === "stopped") {
        done = true
        on.stopped()
      }
    })
    socket.addEventListener("close", () => {
      clearInterval(ping)
      if (done) return
      retry = setTimeout(connect, wait)
      wait = Math.min(wait * 2, 30_000)
    })
  }
  connect()
  return () => {
    done = true
    clearInterval(ping)
    clearTimeout(retry)
    socket?.close()
  }
}

// The name a reader signs comments with, kept in this browser
const NAME_KEY = "owlit-share-name"
export function storedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ""
  } catch {
    return ""
  }
}
export function storeName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // A private window keeps no name; it is asked again next time
  }
}
