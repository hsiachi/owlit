import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "./core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

describe("core.diagnostics", () => {
  it("reports versions, each agent and where the data is, in plain lines", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-diag-")))
    const core = new Core({ userDataDir: path.join(base, "userData"), appVersion: "0.1.0" })
    cores.push(core)
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "core.diagnostics" })
    if (!("result" in response)) throw new Error(JSON.stringify(response))
    const lines = (response.result as string).split("\n")
    expect(lines[0]).toMatch(/^Owlit 0\.1\.0 \(\w+\) · (macOS [\d.]+|\w+) · Node /)
    expect(lines.some((l) => l.startsWith("Claude Code: "))).toBe(true)
    expect(lines).toContain("Workspace: none open")
    expect(lines.at(-1)).toMatch(/^Data: /)
  })
})
