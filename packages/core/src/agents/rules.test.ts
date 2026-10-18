import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { AGENT_RULES, RULES_VERSION } from "./rules.ts"

// Every rules version from 18 on, with the sha1 of its text without the version line. A change to the
// rules adds a line here with a bumped RULES_VERSION; two branches that bump at once conflict on it.
const VERSIONS: [version: number, sha1: string][] = [[18, "8b16c2c9a12bc6407f37f0921fce9fa904a88496"]]

const textHash = () => createHash("sha1").update(AGENT_RULES.slice(AGENT_RULES.indexOf("\n"))).digest("hex")

describe("agent rules", () => {
  it("bump their version whenever the text changes", () => {
    const [version, sha1] = VERSIONS.at(-1)!
    expect(textHash(), `The rules text changed: bump RULES_VERSION in rules.ts and add [${RULES_VERSION + 1}, "${textHash()}"] to VERSIONS here`).toBe(sha1)
    expect(RULES_VERSION, "RULES_VERSION is the last entry of VERSIONS").toBe(version)
  })

  it("bump their version only for a change", () => {
    expect(new Set(VERSIONS.map(([, sha1]) => sha1)).size).toBe(VERSIONS.length)
    expect(VERSIONS.map(([v]) => v)).toEqual(VERSIONS.map(([v]) => v).toSorted((a, b) => a - b))
  })
})
