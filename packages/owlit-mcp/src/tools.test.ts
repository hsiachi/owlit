import { Core } from "@owlit/core"
import { OWLIT_TOOLS, type Touches } from "@owlit/protocol"
import { mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

// The methods each tool calls, read from server.ts's switch: a tool's case labels, then every
// owlit.rpc.<area>.<method> in its body
function methodsByTool(): Map<string, Set<string>> {
  const source = readFileSync(path.join(import.meta.dirname, "server.ts"), "utf8")
  const start = source.indexOf("switch (tool) {")
  const body = source.slice(start, source.indexOf("\n  }\n}", start))
  const out = new Map<string, Set<string>>()
  // A label with no body of its own shares the next one's
  let waiting: string[] = []
  for (const block of body.split(/\n(?=    case ")/).slice(1)) {
    const label = /^    case "([a-z_]+)":/.exec(block)![1]!
    if (!block.slice(block.indexOf(":") + 1).trim()) {
      waiting.push(label)
      continue
    }
    const methods = new Set([...block.matchAll(/owlit\.rpc\.([a-zA-Z]+)\.([a-zA-Z]+)/g)].map((m) => `${m[1]}.${m[2]}`))
    for (const each of [...waiting, label]) out.set(each, methods)
    waiting = []
  }
  return out
}

const core = new Core({ userDataDir: realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-tools-"))) })
afterAll(() => core.dispose())
const router = (core as unknown as { router: { touchesOf(method: string): Touches | "depends" | undefined } }).router

describe("owlit's tools", () => {
  // A tool's touches only says in its description what each role gets; core's method decides. The two are
  // declared apart, so this keeps them saying the same thing.
  it("each says it touches what the methods it calls touch", () => {
    const methods = methodsByTool()
    for (const tool of OWLIT_TOOLS) {
      const called = methods.get(tool.name)
      expect(called, `${tool.name} has a case in server.ts`).toBeDefined()
      const classes = [...called!].map((m) => [m, router.touchesOf(m)] as const)
      for (const [method, touches] of classes) expect(touches, `${method}, called by ${tool.name}, is a method of core's`).toBeDefined()
      const changing = new Set(classes.map(([, t]) => t).filter((t) => t !== "read"))
      // A method whose class depends on its params and target (comments.put) can't be compared here; the
      // policy's own tests cover it
      if (changing.has("depends")) continue
      expect(changing.size, `${tool.name} changes through one class`).toBeLessThanOrEqual(1)
      expect(tool.touches, tool.name).toBe([...changing][0] ?? "read")
    }
  })
})
