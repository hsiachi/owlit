import { RpcErrorCode, type UiRequest } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { RpcFailure } from "../rpc/index.ts"

const ANSWER_WITHIN_MS = 5000

// Core asking a window to do something only the window can (read or change an open editor). Windows
// say which docs they have open; core sends a ui.request notification to the one that has the doc, and
// that window answers with ui.respond. A window that doesn't answer in time is treated as gone.
export class UiBridge {
  private openDocs = new Map<string, Set<string>>()
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly send: (request: UiRequest) => void

  constructor(send: (request: UiRequest) => void) {
    this.send = send
  }

  setOpenDocs(clientId: string, paths: string[]) {
    if (paths.length) this.openDocs.set(clientId, new Set(paths))
    else this.openDocs.delete(clientId)
    return null
  }

  // The window that has this doc open, if any
  holder(rel: string) {
    for (const [clientId, paths] of this.openDocs) if (paths.has(rel)) return clientId
    return undefined
  }

  request<T>(clientId: string, method: UiRequest["method"], params: UiRequest["params"]): Promise<T> {
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        // Its window is gone or stuck: stop sending it anything
        this.openDocs.delete(clientId)
        reject(new Error("The window didn't answer."))
      }, ANSWER_WITHIN_MS)
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.send({ requestId, clientId, method, params } as UiRequest)
    })
  }

  respond(requestId: string, result?: unknown, error?: string) {
    const waiting = this.pending.get(requestId)
    if (!waiting) throw new RpcFailure(RpcErrorCode.NotFound, "Nothing is waiting for that answer.")
    clearTimeout(waiting.timer)
    this.pending.delete(requestId)
    if (error !== undefined) waiting.reject(new Error(error))
    else waiting.resolve(result)
    return null
  }

  // Workspace switch: what windows had open belonged to the old one
  reset() {
    this.openDocs.clear()
  }
}
