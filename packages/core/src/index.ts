// owlit's backend. Plain Node: no Electron, no React. The desktop app, and later the CLI and owlit-mcp,
// reach it only through JSON-RPC.

export { Core, CORE_VERSION, type CoreOptions } from "./core.ts"
export { RpcFailure } from "./rpc/index.ts"
export type { BrowserEvent, BrowserHost, BrowserRequest, Host, PublisherNeed } from "./host.ts"
export { NeedsUser, Refused } from "./host.ts"
export { pdfLinkOn, siteOf } from "./library/browser-routes.ts"
export { socketHash, socketPaths, type SocketPointer } from "./rpc/socket.ts"
