import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { OWLIT_FOLDERS } from "../workspace/paths.ts"
import { STATE_PATTERNS } from "./profiles.ts"

const PACKAGES = path.join(import.meta.dirname, "../../..")

// Every .ts file under a folder, tests included (they name folders the code makes)
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : sources(path.join(dir, e.name))) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []))

describe("owlit's state kept from an agent's own reads", () => {
  it("names every folder the code keeps in .owlit/", () => {
    const named = new Set<string>()
    for (const pkg of ["core", "owlit-agent", "owlit-mcp"]) {
      for (const file of sources(path.join(PACKAGES, pkg, "src"))) {
        const text = readFileSync(file, "utf8")
        for (const m of text.matchAll(/(?:OWLIT_DIR|owlitDir|"\.owlit"),\s*"([a-zA-Z-]+)"|(?:\.owlit|\$\{OWLIT_DIR\})\/([a-zA-Z-]+)\//g)) named.add(m[1] ?? m[2]!)
      }
    }
    expect(named.size).toBeGreaterThan(5)
    expect([...named].filter((dir) => !(OWLIT_FOLDERS as readonly string[]).includes(dir))).toEqual([])
  })

  it("denies an agent's own reads in each of them but the files attached in chats", () => {
    for (const dir of OWLIT_FOLDERS) expect(STATE_PATTERNS).toContain(dir === "chats" ? ".owlit/chats/*.json" : `.owlit/${dir}/**`)
  })
})
