import { RpcErrorCode } from "@owlit/protocol"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, expect, it } from "vitest"
import { Core } from "../core.ts"

// The protocol's method names, read from its source: MethodName is a type only, and each area registers
// its own methods (core.ts calls every register*), so a forgotten call would pass typecheck
function protocolMethods() {
  const source = readFileSync(path.join(import.meta.dirname, "../../../protocol/src/rpc.ts"), "utf8")
  const body = source.slice(source.indexOf("export interface Methods {"), source.indexOf("export interface Notifications {"))
  return [...body.matchAll(/^ {2}"([\w]+\.[\w]+)": \{/gm)].map((m) => m[1]!)
}

const core = new Core({ userDataDir: mkdtempSync(path.join(tmpdir(), "owlit-methods-")), debug: true })
afterAll(() => core.dispose())

it("has a handler for every method the protocol names", async () => {
  const methods = protocolMethods()
  expect(methods.length).toBeGreaterThan(100)
  // Params no method takes: the router finds the route, then refuses them before any handler runs
  const missing: string[] = []
  for (const method of methods) {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params: 42 as never })
    if ("error" in response && response.error.code === RpcErrorCode.MethodNotFound) missing.push(method)
  }
  expect(missing).toEqual([])
})
