import { describe, expect, it } from "vitest"
import { digestSourceNotes } from "./digest-source"

describe("a digest's header", () => {
  it("says nothing when the digest read everything there is, in the paper's script", () => {
    expect(digestSourceNotes({ pictures: 3, language: "en", textPages: 12, cjkText: false }, 12)).toEqual([])
    expect(digestSourceNotes({}, 12)).toEqual([])
  })

  it("says the figures weren't seen, the pages it had, and a language other than the paper's", () => {
    expect(digestSourceNotes({ pictures: 0, language: "zh-Hans", textPages: 8, cjkText: false }, 30)).toEqual([
      "Read from the text only; figures not seen.",
      "Pages 1–8 of 30",
      "In 简体中文",
    ])
  })
})
