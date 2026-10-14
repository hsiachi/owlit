import { describe, expect, it } from "vitest"
import { collectionMarkdown } from "./export"
import { seedCollections } from "./mocks/seed"

describe("a collection exported as a doc", () => {
  const all = Object.values(seedCollections())

  it("starts with the title and the memo, papers and the collection kept as links", () => {
    const c = all.find((c) => c.memo.length)!
    const md = collectionMarkdown(c, new Date(2026, 9, 14))
    expect(md.startsWith(`# ${c.title}\n\n- ${c.memo[0]!.text}`)).toBe(true)
    expect(md).toContain(`(owlit://library/${c.rows[0]!.id})`)
    expect(md.trim().split("\n").at(-1)).toMatch(new RegExp(`\\(owlit://collections/${c.id}\\)`))
  })

  it("has one table row per paper, under its group's heading, every line with the same cells", () => {
    const c = all.find((c) => c.groups.length)!
    const md = collectionMarkdown(c)
    for (const g of c.groups.filter((g) => c.rows.some((r) => r.group === g.id))) expect(md).toMatch(new RegExp(`^#{2,} ${g.name}$`, "m"))
    const lines = md.split("\n").filter((l) => l.startsWith("| ["))
    expect(lines).toHaveLength(c.rows.length)
    const cells = (l: string) => l.replace(/\\\|/g, "").split("|").length
    expect(new Set(md.split("\n").filter((l) => l.startsWith("|")).map(cells)).size).toBe(1)
  })
})
