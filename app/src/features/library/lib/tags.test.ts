import { describe, expect, it } from "vitest"
import { tagsFirst } from "./tags"

describe("tagsFirst", () => {
  it("puts the tags the list is narrowed to first, so the one shown is never behind +n", () => {
    expect(tagsFirst(["benchmarks", "agents"], ["agents"])).toEqual(["agents", "benchmarks"])
    expect(tagsFirst(["a", "b", "c"], ["c", "b"])).toEqual(["b", "c", "a"])
  })

  it("keeps the paper's own order without a tag filter", () => {
    const tags = ["benchmarks", "agents"]
    expect(tagsFirst(tags, [])).toBe(tags)
  })
})
