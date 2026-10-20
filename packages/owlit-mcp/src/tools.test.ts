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

// A write as owlit_help('threads') tells the agent to make one: a new thread with its report, its one
// line, a grouping and rows that say what each paper is, how it bears and how it was found
const SKILL_WRITE = {
  asked: "帮我了解前瞻记忆的理论",
  title: "前瞻记忆的定义与理论模型",
  project: "Proactive",
  one: "Two families of models, and a gap where wearable reminders sit.",
  report:
    "Prospective memory is remembering to act later; [Multiprocess framework](owlit://library/doi-10.1037-0096-3445.129.3.347) and [The PAM theory](owlit://library/doi-10.1037-0278-7393.29.3.347) split on whether noticing the cue costs attention.\n\n## Monitoring\n\n…",
  note: "2000 on; a model of how an intention is retrieved. Excluded clinical studies without a model.",
  groups: JSON.stringify([
    { id: "spont", name: "Spontaneous retrieval", one: "the cue brings the intention back" },
    { id: "monitor", name: "Monitoring", one: "attention is spent watching for the cue" },
  ]),
  rows: JSON.stringify([
    {
      id: "doi-10.1037-0096-3445.129.3.347",
      is: "Theory paper with four experiments",
      answer: "Retrieval can be spontaneous when the cue is focal.",
      depth: "full",
      quote: "retrieval can occur spontaneously",
      found_by: "search: prospective memory model",
      group: "spont",
    },
    {
      id: "doi-10.1037-0278-7393.29.3.347",
      is: "Lab experiments, 3 studies",
      answer: "Noticing the cue always costs some attention.",
      depth: "abstract",
      found_by: "cited by the multiprocess framework",
      groups: ["monitor", "spont"],
    },
  ]),
}

describe("thread_write", () => {
  const spec = OWLIT_TOOLS.find((t) => t.name === "thread_write")!

  it("declares every field of a write in the skill's shape", () => {
    for (const key of Object.keys(SKILL_WRITE)) expect(spec.inputSchema.properties, key).toHaveProperty(key)
    expect(spec.inputSchema.properties).not.toHaveProperty("memo")
    const rows = spec.inputSchema.properties.rows!.description
    for (const row of JSON.parse(SKILL_WRITE.rows) as Record<string, unknown>[]) for (const key of Object.keys(row)) expect(rows, key).toContain(`"${key}"`)
    const groups = spec.inputSchema.properties.groups!.description
    for (const group of JSON.parse(SKILL_WRITE.groups) as Record<string, unknown>[]) for (const key of Object.keys(group)) expect(groups, key).toContain(`"${key}"`)
  })

  it("names a paper in the report one way, by its short title, as the skill does", () => {
    const report = spec.inputSchema.properties.report!.description
    expect(report).toContain("[CiteSee](owlit://library/<id>)")
    expect(report).not.toMatch(/Author Year/)
    const ids = new Set((JSON.parse(SKILL_WRITE.rows) as { id: string }[]).map((r) => r.id))
    for (const [, id] of SKILL_WRITE.report.matchAll(/\]\(owlit:\/\/library\/([^)#\s]+)\)/g)) expect(ids).toContain(id)
  })
})
