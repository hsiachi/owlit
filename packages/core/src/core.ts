import type { CoreVersion, RpcNotification, RpcRequest, RpcResponse } from "@owlit/protocol"
import { noParams, Notifier, Router } from "./rpc/index.ts"

export const CORE_VERSION = "0.0.0"

export interface CoreOptions {
  // Reported by core.version; the host knows it (Electron's app.getVersion())
  appVersion?: string
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
export class Core {
  private router = new Router()
  private notifier = new Notifier()
  private started = false
  private options: CoreOptions

  constructor(options: CoreOptions = {}) {
    this.options = options
    this.router.register("core.ping", noParams, () => ({ ok: true as const }))
    this.router.register("core.version", noParams, () => this.version())
  }

  handle(request: RpcRequest): Promise<RpcResponse> {
    return this.router.handle(request)
  }

  onNotify(listener: (notification: RpcNotification) => void) {
    return this.notifier.subscribe(listener)
  }

  start() {
    if (this.started) return
    this.started = true
    this.notifier.notify("core.hello", this.version())
  }

  dispose() {
    this.started = false
  }

  private version(): CoreVersion {
    return { version: this.options.appVersion ?? CORE_VERSION, node: process.versions.node }
  }
}
