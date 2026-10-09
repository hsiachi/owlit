// owlit's backend. Plain Node: no Electron, no React. The desktop app, and later the CLI and owlit-mcp,
// reach it only through JSON-RPC.

export { Core, CORE_VERSION, type CoreOptions } from "./core.ts"
export { RpcFailure } from "./rpc/index.ts"
export type { BrowserHost, BrowserRequest, Host } from "./host.ts"
