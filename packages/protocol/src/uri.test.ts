import { describe, expect, it } from "vitest"
import { docUri, MENTION_LINK, paperUri, parseOwlitUri, topicUri } from "./uri.ts"

describe("parseOwlitUri", () => {
  it.each([
    [paperUri("p6"), { kind: "paper", id: "p6" }],
    [paperUri("p6", "tf-filter"), { kind: "paper", id: "p6", passage: "tf-filter" }],
    ["owlit://library/p6#abstract", { kind: "paper", id: "p6", abstract: true }],
    ["owlit://library/p6#p12", { kind: "paper", id: "p6", page: 12 }],
    [docUri("writing/Related work.md"), { kind: "doc", path: "writing/Related work.md" }],
    [topicUri("when-to-call"), { kind: "knowledge", topicId: "when-to-call", block: undefined }],
    [topicUri("when-to-call", "q1"), { kind: "knowledge", topicId: "when-to-call", block: "q1" }],
    ["owlit://chat/c1", { kind: "chat", id: "c1" }],
    ["owlit://settings/proxy", { kind: "settings", section: "proxy" }],
    ["owlit://settings", { kind: "settings", section: undefined }],
    ["owlit://shortcuts", { kind: "shortcuts" }],
    ["owlit://highlight/h1", null],
    ["https://example.com", null],
  ])("%s", (uri, parsed) => {
    expect(parseOwlitUri(uri)).toEqual(parsed)
  })
})

describe("MENTION_LINK", () => {
  it("finds a mention with escaped brackets and leaves other owlit links alone", () => {
    expect(MENTION_LINK.exec("see [Lam \\[2024\\]](owlit://library/p1).")?.slice(1)).toEqual(["Lam \\[2024\\]", "owlit://library/p1"])
    expect(MENTION_LINK.exec("[p. 3](owlit://highlight/h1)")).toBeNull()
  })
})
