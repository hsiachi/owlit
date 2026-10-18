// owlit's backend. Plain Node: no Electron, no React. The desktop app, and later the CLI and owlit-mcp,
// reach it only through JSON-RPC.

export { Core, CORE_VERSION, type CoreOptions } from "./core.ts"
export { RpcFailure } from "./rpc/index.ts"
export type { Host, UpdaterHost } from "./host.ts"
export { browserAppOf, type BrowserApp } from "./extension/browser-app.ts"
export { socketHash, socketPaths, type SocketPointer } from "./rpc/socket.ts"
