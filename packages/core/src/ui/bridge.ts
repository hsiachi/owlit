import { RpcErrorCode, type UiActions, type UiMethod, type UiRequest } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { RpcFailure } from "../rpc/index.ts"

// A window answers an editor read or write at once; showing a paper can mean loading its PDF first
const ANSWER_WITHIN_MS = 5000
const ACT_WITHIN_MS = 20_000

// Core asking a window to do something only the window can: read or change a doc in its editor, or show
// the user something (open a paper, go to a passage, highlight it). Windows say which docs they have
// open and when the user comes to them; core sends a ui.request notification naming one window, and
// that window answers with ui.respond. A window that doesn't answer in time is treated as gone.
export class UiBridge {
  private openDocs = new Map<string, Set<string>>()
  // Windows in the order the user was last in them, latest last
  private focused: string[] = []
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

  focus(clientId: string) {
    this.focused = [...this.focused.filter((id) => id !== clientId), clientId]
    return null
  }

  // The window that has this doc open, if any
  holder(rel: string) {
    for (const [clientId, paths] of this.openDocs) if (paths.has(rel)) return clientId
    return undefined
  }

  request<M extends UiMethod>(clientId: string, method: M, params: UiActions[M]["params"], within = ANSWER_WITHIN_MS): Promise<UiActions[M]["result"]> {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        // Its window is gone or stuck: stop sending it anything
        this.forget(clientId)
        reject(new RpcFailure(RpcErrorCode.Unavailable, "The owlit window didn't answer."))
      }, within)
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.send({ requestId, clientId, method, params } as UiRequest)
    })
  }

  // Asks the window the user was in last; a window's refusal ("not in the library") comes back as NotFound
  act<M extends Exclude<UiMethod, "fs.read" | "fs.write">>(method: M, params: UiActions[M]["params"]) {
    const clientId = this.focused.at(-1)
    if (!clientId) return Promise.reject(new RpcFailure(RpcErrorCode.Unavailable, "No owlit window is open."))
    return this.request(clientId, method, params, ACT_WITHIN_MS).catch((error: Error) => {
      throw error instanceof RpcFailure ? error : new RpcFailure(RpcErrorCode.NotFound, error.message)
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

  // Workspace switch: what windows had open belonged to the old one. Windows say they are there again
  // once the new workspace is open.
  reset() {
    this.openDocs.clear()
    this.focused = []
  }

  leave(clientId: string) {
    this.forget(clientId)
    return null
  }

  private forget(clientId: string) {
    this.openDocs.delete(clientId)
    this.focused = this.focused.filter((id) => id !== clientId)
  }
}
