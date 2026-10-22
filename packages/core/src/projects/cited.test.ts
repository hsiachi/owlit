import type { Project, ReadFrom } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { citationKey } from "../docs/citations.ts"
import { citationSpans } from "../library/wear.ts"
import { Cited, sentenceAround, type CitedServices } from "./cited.ts"

const link = (id: string, quote?: string) => `[${id} 2024](owlit://library/${id}${quote ? ` "${quote}"` : ""})`

const project = (path: string, name: string, drafts: string[] = []): Project => ({
  path,
  mark: `${path}/project.md`,
  name,
  parents: [],
  currentDrafts: drafts.map((d) => ({ kind: d, path: d, modifiedAt: 1 })),
})

function setup(texts: Record<string, string>, over: Partial<Omit<CitedServices, "projects">> & { projects?: Project[] } = {}) {
  const mtimes: Record<string, number> = Object.fromEntries(Object.keys(texts).map((k) => [k, 1]))
  const reads: string[] = []
  const cited = new Cited({
    files: async () => Object.keys(texts).map((path) => ({ path, modifiedAt: mtimes[path] })),
    read: async (rel) => {
      reads.push(rel)
      return texts[rel] ?? null
    },
    // "doi-kim" is an old id of kim; "gone" isn't in the Library
    canonical: async (id) => (id === "doi-kim" ? "kim" : id === "gone" ? undefined : id),
    owlitDepths: async () => new Map(),
    ...over,
    projects: async () => over.projects ?? [],
  })
  return { cited, reads, touch: (rel: string, text: string) => ((texts[rel] = text), (mtimes[rel] = (mtimes[rel] ?? 0) + 1)) }
}

describe("a project's cited papers", () => {
  const texts = {
    "Proactive/project.md": "# Proactive",
    "Proactive/story-v3.md": `Agents help ${link("kim")}. Typing is slow ${link("lee")}.`,
    "Proactive/story-v2.md": `Old ${link("old")} and ${link("doi-kim")}, ${link("sub")}.`,
    "Proactive/Study/project.md": "# Study",
    "Proactive/Study/plan.md": `Sub ${link("sub")} ${link("gone")}.`,
    "ADHD/project.md": "# ADHD Support",
    "ADHD/draft.md": `Shared ${link("lee")} and ${link("kim")}; ${link("sub")}.`,
    "loose.md": `Outside ${link("kim")}.`,
  }
  const projects = [project("ADHD", "ADHD Support", ["ADHD/draft.md"]), project("Proactive", "Proactive", ["Proactive/story-v3.md"]), project("Proactive/Study", "Study", ["Proactive/Study/plan.md"])]

  it("cites by the current drafts, and by every doc under it with its sub-projects'", async () => {
    const { cited } = setup(texts, { projects })
    const { drafts, all } = await cited.ofProject("Proactive")
    expect(drafts.map((p) => p.id)).toEqual(["kim", "lee"])
    expect(all.map((p) => p.id).sort()).toEqual(["kim", "lee", "old", "sub"])
    // Under any id it goes by, drafts first
    expect(all.find((p) => p.id === "kim")!.docs).toEqual(["Proactive/story-v3.md", "Proactive/story-v2.md"])
  })

  it("names the other projects citing a paper, not its own sub-projects nor a doc in no project", async () => {
    const { cited } = setup(texts, { projects })
    const { all } = await cited.ofProject("Proactive")
    const also = Object.fromEntries(all.map((p) => [p.id, p.also.map((a) => a.name)]))
    expect(also).toEqual({ kim: ["ADHD Support"], lee: ["ADHD Support"], old: [], sub: ["ADHD Support"] })
    // From the sub-project, its parent's docs are another project's
    const study = await cited.ofProject("Proactive/Study/")
    expect(study.all.map((p) => [p.id, p.also.map((a) => a.path)])).toEqual([["sub", ["ADHD", "Proactive"]]])
    expect(await cited.ofProject("Nowhere")).toEqual({ drafts: [], all: [] })
  })

  it("gives the deepest Owlit read behind its own citations in the project's docs", async () => {
    const depths: Record<string, Map<string, ReadFrom["depth"]>> = {
      "Proactive/story-v3.md": new Map([[citationKey({ paperId: "kim" }), "abstract"]]),
      "Proactive/story-v2.md": new Map([[citationKey({ paperId: "doi-kim" }), "part"]]),
      // Another project's reading isn't this one's
      "ADHD/draft.md": new Map([[citationKey({ paperId: "lee" }), "full"]]),
    }
    const { cited } = setup(texts, { projects, owlitDepths: async (rel) => depths[rel] ?? new Map() })
    const { all } = await cited.ofProject("Proactive")
    expect(Object.fromEntries(all.map((p) => [p.id, p.depth ?? null]))).toEqual({ kim: "part", lee: null, old: null, sub: null })
  })

  it("reads a doc again only once it changed", async () => {
    const { cited, reads, touch } = setup({ ...texts }, { projects })
    await cited.ofProject("Proactive")
    const first = reads.length
    await cited.ofProject("Proactive")
    expect(reads.length).toBe(first)
    touch("Proactive/story-v3.md", `Now ${link("new")}.`)
    expect((await cited.ofProject("Proactive")).drafts.map((p) => p.id)).toEqual(["new"])
    expect(reads.slice(first)).toEqual(["Proactive/story-v3.md"])
  })
})

describe("the docs citing a paper", () => {
  it("lists each doc with the sentences around its citations, under any id", async () => {
    const { cited } = setup({
      "b.md": `# Notes\n\nFirst point. Agents help novices most ${link("doi-kim", "Agents help.")} as Smith et al. found. Next point.\n\n- Typing ${link("kim")}`,
      "a.md": `Nothing here ${link("lee")}.`,
    })
    expect(await cited.citing("kim")).toEqual([
      {
        path: "b.md",
        sentences: [
          { from: expect.any(Number), text: "Agents help novices most doi-kim 2024 as Smith et al. found." },
          { from: expect.any(Number), text: "Typing kim 2024" },
        ],
      },
    ])
  })
})

describe("sentenceAround", () => {
  it("keeps to the citation's sentence on its line, a label's period ending nothing", () => {
    const text = `Before. See ${link("a")} and [Lee et al. 2020](owlit://library/lee) for this. After.\nNext line.`
    const spans = citationSpans(text)
    expect(sentenceAround(text, spans[1].from, spans[1].to, spans)).toBe("See a 2024 and Lee et al. 2020 for this.")
    const bold = `**5. 四环节。** 交给助手后各有变化（${link("a")}）。**6. 下一条。**`
    const [b] = citationSpans(bold)
    expect(sentenceAround(bold, b.from, b.to)).toBe("交给助手后各有变化（a 2024）。")
    const numbered = `4. **Four steps.** Each has a cost ${link("a")}.`
    const [n] = citationSpans(numbered)
    expect(sentenceAround(numbered, n.from, n.to)).toBe("Each has a cost a 2024.")
    const zh = "这是一句。代理有帮助[a](owlit://library/a)。下一句。"
    const [c] = citationSpans(zh)
    expect(sentenceAround(zh, c.from, c.to)).toBe("代理有帮助a。")
  })
})
