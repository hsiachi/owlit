import { describe, expect, it } from "vitest"
import { citeKeyBase, uniqueCiteKey } from "./cite-key.ts"

describe("cite keys", () => {
  it("are family name, year and the first real word of the title", () => {
    expect(citeKeyBase({ id: "a", title: "The Large Language Model Survey", authors: ["Xin Wang"], year: 2023, ids: {} })).toBe("wang2023large")
    expect(citeKeyBase({ id: "b", title: "Sensible Agent: A Framework", authors: ["Geonsun Lee", "Min Xia"], year: 2025, ids: {} })).toBe("lee2025sensible")
  })

  it("drop accents and keep only letters and digits", () => {
    expect(citeKeyBase({ id: "a", title: "Über große Modelle", authors: ["José Müller-Łukasz"], year: 2021, ids: {} })).toBe("mullerlukasz2021uber")
  })

  it("take the DOI's suffix when the first author's name has no Latin letters", () => {
    expect(citeKeyBase({ id: "cn1", title: "检索增强生成综述", authors: ["王小明", "李华"], ids: { doi: "10.13328/j.cnki.jos.006543" } })).toBe("j.cnki.jos.006543")
  })

  it("take the paper's id when there is no DOI either, never anon", () => {
    expect(citeKeyBase({ id: "s2-8f3a91", title: "大语言模型的检索增强", authors: ["张三"], ids: {} })).toBe("s2-8f3a91")
    expect(citeKeyBase({ id: "x", title: "", authors: [], ids: {} })).toBe("x")
  })

  it("get a letter after the base when another paper has it", () => {
    const taken = new Set(["wang2023large", "wang2023largea"])
    expect(uniqueCiteKey("wang2023large", (k) => taken.has(k))).toBe("wang2023largeb")
    expect(uniqueCiteKey("vaswani2017attention", (k) => taken.has(k))).toBe("vaswani2017attention")
  })
})
