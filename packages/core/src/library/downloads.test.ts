import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { addressesIn, hasDoi, whoseDownload } from "./downloads.ts"

// A "Where from" list as a browser writes it: a binary property list of the addresses
function whereFroms(addresses: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-wherefrom-"))
  const xml = path.join(dir, "list.plist")
  const strings = addresses.map((a) => `<string>${a.replace(/&/g, "&amp;")}</string>`).join("")
  writeFileSync(xml, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array>${strings}</array></plist>`)
  execFileSync("plutil", ["-convert", "binary1", xml])
  return execFileSync("cat", [xml])
}

describe("where a download was saved from", () => {
  it("finds a DOI only whole", () => {
    expect(hasDoi("https://dl.acm.org/doi/pdf/10.1145/123456?download=true", "10.1145/123456")).toBe(true)
    expect(hasDoi("https://dl.acm.org/doi/pdf/10.1145/123456", "10.1145/123456")).toBe(true)
    expect(hasDoi("https://example.org/10.1145/123456.pdf", "10.1145/123456")).toBe(true)
    expect(hasDoi("https://example.org/doi/10.1145/123456/full#s1", "10.1145/123456")).toBe(true)
    expect(hasDoi("https://example.org/get?doi=10.1145%2F123456&type=pdf", "10.1145/123456")).toBe(true)
    // Another paper whose DOI begins with this one's
    expect(hasDoi("https://dl.acm.org/doi/pdf/10.1145/1234567?download=true", "10.1145/123456")).toBe(false)
    expect(hasDoi("https://dl.acm.org/doi/pdf/10.1145/123456.7890", "10.1145/123456")).toBe(false)
    expect(hasDoi("https://example.org/210.1145/123456", "10.1145/123456")).toBe(false)
  })

  it("reads the addresses out of the attribute, plain or as a property list", () => {
    expect(addressesIn(Buffer.from("https://dl.acm.org/doi/pdf/10.1145/1"))).toEqual(["https://dl.acm.org/doi/pdf/10.1145/1"])
  })

  it.runIf(process.platform === "darwin")("reads a browser's list of addresses, so what follows one isn't taken as part of it", () => {
    const list = ["https://dl.acm.org/doi/pdf/10.1145/123456", "https://dl.acm.org/doi/10.1145/123456", "https://例子.org/a"]
    expect(addressesIn(whereFroms(list))).toEqual(list)
  })

  it.runIf(process.platform === "darwin")("takes a file for the paper it was saved for, not one whose DOI begins the same", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "owlit-downloads-"))
    const file = path.join(dir, "paper.pdf")
    writeFileSync(file, "%PDF-1.4\n%%EOF\n")
    const attr = whereFroms(["https://dl.acm.org/doi/pdf/10.1145/1234567?download=true", "https://dl.acm.org/doi/10.1145/1234567"])
    execFileSync("xattr", ["-wx", "com.apple.metadata:kMDItemWhereFroms", attr.toString("hex"), file])
    const nothingSaid = async () => ({ text: "" })
    const shorter = { id: "short", doi: "10.1145/123456", title: "Short" }
    const longer = { id: "long", doi: "10.1145/1234567", title: "Long" }
    expect(await whoseDownload(file, [shorter, longer], nothingSaid)).toEqual({ id: "long", sure: true })
    // With only the other paper waiting, the address says nothing for it: its pages are read instead
    expect(await whoseDownload(file, [shorter, { ...longer, doi: "10.9999/x" }], async () => ({ doi: "10.9999/x", text: "" }))).toEqual({ id: "long", sure: true })
    expect(await whoseDownload(file, [shorter], async () => ({ doi: "10.1145/1234567", text: "" }))).toBeUndefined()
  })
})
