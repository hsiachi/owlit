// owlit's backend. Plain Node: no Electron, no React. The desktop app, and later the CLI and owlit-mcp,
// reach it only through JSON-RPC.

export { Core, CORE_VERSION, type CoreOptions } from "./core.ts"
export { RpcFailure } from "./rpc/index.ts"
export type { BrowserControl, BrowserEvent, BrowserHost, BrowserRequest, Host, PageSeen, PublisherNeed } from "./host.ts"
export { NeedsUser, NoPdfOnPage } from "./host.ts"
export { pdfFromLanded, pdfLinkOn, siteOf } from "./library/browser-routes.ts"
export { isPdfBytes, PDF_MAX_BYTES } from "./library/pdf.ts"
export { ACCESS_OFFER, isCheckTitle } from "./library/where-it-ended.ts"
export { socketHash, socketPaths, type SocketPointer } from "./rpc/socket.ts"
