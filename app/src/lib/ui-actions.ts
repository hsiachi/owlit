// What core asks this window to do (UiActions in protocol): read or change a doc in its editor, or show
// the user something an agent pointed at. Features register a handler per method; core names one
// window per request, so this window answers only its own. The window the user came to last is the
// one agents' actions go to, so it says so whenever it comes to the front.

import type { UiActions, UiMethod } from "@owlit/protocol"
import { onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"

// This window, for as long as it is loaded
export const clientId = crypto.randomUUID()

type Handler<M extends UiMethod> = (params: UiActions[M]["params"]) => UiActions[M]["result"] | Promise<UiActions[M]["result"]>
const handlers: { [M in UiMethod]?: Handler<M> } = {}

// A handler throws to refuse, with a sentence the agent reads ("That paper isn't in the library.")
export function registerUiHandler<M extends UiMethod>(method: M, handler: Handler<M>) {
  ;(handlers as Record<string, unknown>)[method] = handler
}

export function startUiActions() {
  onNotify("ui.request", async (request) => {
    if (request.clientId !== clientId) return
    const handler = handlers[request.method] as Handler<UiMethod> | undefined
    const answer = (reply: { result?: unknown; error?: string }) => void rpc.ui.respond({ requestId: request.requestId, ...reply }).catch(() => undefined)
    if (!handler) return answer({ error: `This owlit window can't do ${request.method}.` })
    try {
      answer({ result: (await handler(request.params as never)) ?? null })
    } catch (error) {
      answer({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  const focus = () => void rpc.ui.focus({ clientId }).catch(() => undefined)
  window.addEventListener("focus", focus)
  // A window opened to show something (the extension's Open) was focused before this page could hear it
  if (document.hasFocus()) focus()
  window.addEventListener("pagehide", () => void rpc.ui.leave({ clientId }).catch(() => undefined))
  // Core forgets windows when it switches workspace
  onWorkspaceOpened(focus)
}

// Resolves once `get` has something, checking whenever `subscribe` says things changed; rejects with
// `message` after `ms`
export function waitFor<T>(get: () => T | null | undefined, subscribe: (changed: () => void) => () => void, ms: number, message: string): Promise<T> {
  const now = get()
  if (now) return Promise.resolve(now)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error(message))
    }, ms)
    const stop = subscribe(() => {
      const value = get()
      if (!value) return
      clearTimeout(timer)
      stop()
      resolve(value)
    })
  })
}
