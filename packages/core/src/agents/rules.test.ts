import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { AGENT_RULES, RULES_VERSION } from "./rules.ts"

// Every rules version from 18 on, with the sha1 of its text without the version line. A change to the
// rules adds a line here with a bumped RULES_VERSION; two branches that bump at once conflict on it.
const VERSIONS: [version: number, sha1: string][] = [
  [18, "8b16c2c9a12bc6407f37f0921fce9fa904a88496"],
  [19, "3996c95f0735ef9bf8e240345c6bbecab39facaf"],
  [20, "2cc0ceed96b27b17afab08621b6134736169dc39"],
  [21, "5f491cf63f4827eaf6f147fa622f5a1f3d56a37a"],
  [22, "61bd186d90d8e99fc2bf4bbb9be7ffe65a151ee1"],
  [23, "0875e024abc01fcd9211e58828882a6f744d0b68"],
  [24, "39051460de8eea9b21876ec15452e08c7c4d5cb5"],
  [25, "49d15118f53cee77389d1c6ede4f4bc6cfd7f8d7"],
  [26, "4a57019d1bcc68635754cef3cc0a5a7f9bb07d3c"],
  [27, "73e59885e861a48b60ef8714c03e7eabbfafcc3f"],
  [28, "ea59fbc43166fc020d2376753ce1f77f5aa4469a"],
  [29, "45205533c6a338ca60e8b5f6fcbf0bd3aeaf2234"],
  [30, "8f8238bff936597b3591715a4f902ab022d5fde6"],
  [31, "cd8fb5c9ec7e5701cd284d65031147d9dfca1760"],
  [32, "49f61245b643fcc55068733b65a60d7f2769923e"],
  [33, "2641cf7ce8bd095ce10a942f06938b6bf9ef1fdf"],
  [34, "2b1d0b0ef121eaa7cd7df635305e01d97b88dca3"],
  [35, "aa4495d08d261e29203a5077df8399f9b7709bf9"],
  [36, "388ff15bcad67e74c321f36b856599b3cc9199c9"],
  [37, "3485b02fee6dd6cf716fd4280c68521b67649b9c"],
  [38, "a7c657f841a19d5a9bd7183adc1057a56d7b456f"],
  [39, "6c28bfb8ac28a6ccd5cf166f7bc29af8958a546c"],
]

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
