import type { Paper, ThreadRead } from "@owlit/protocol"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { PaperPeek } from "@/features/library/components/PaperPeek"
import { RowPeek } from "@/features/threads/components/AnswerRows"
import { exampleThreads } from "@/test/example-workspace"
import { PaperCard } from "./paper-card"

const html = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe("the paper card", () => {
  const paper: Paper = {
    id: "arxiv-2303.08896",
    title: "SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models",
    authors: ["Potsawee Manakul", "Adian Liusie", "Mark J. F. Gales"],
    year: 2023,
    venue: "EMNLP",
    abstract: "Generative Large Language Models (LLMs) such as GPT-3 are capable of generating highly fluent responses to a wide variety of user prompts. However, LLMs are known to hallucinate facts.",
    ids: { arxiv: "2303.08896" },
    pdf: { url: "owlit-file://workspace/library/papers/arxiv-2303.08896/paper.pdf", pages: 15 },
    citations: { count: 900, source: "openalex", at: 1 },
    addedAt: 1,
    addedBy: "p_1",
    starred: false,
    status: "read",
    tags: ["detection"],
  }

  it("says the paper's byline, its PDF and its abstract, and ends in the place's own footer", () => {
    const out = html(<PaperCard facts={paper} paper={paper} footer={<button type="button">Footer</button>} />)
    expect(out).toContain(paper.authors[0])
    expect(out).toContain(paper.venue!)
    expect(out).toContain(String(paper.year))
    expect(out).toContain("PDF")
    expect(out).toContain(paper.abstract!.slice(0, 40))
    expect(out).toContain("Footer")
    expect(out).not.toContain("In this thread")
  })

  it("says where a paper without its PDF stands, as its No PDF card does", () => {
    const without: Paper = { ...paper, pdf: undefined, pdfState: { state: "no-pdf", reason: { by: "search", ended: "no-copy", at: 0 }, tried: [] } }
    expect(html(<PaperCard facts={without} paper={without} footer={null} />)).toContain("No PDF found")
  })

  it("in the Library ends with the reading status and Open, with no thread part", () => {
    const out = html(<PaperPeek paper={paper} />)
    expect(out).toContain("Open")
    expect(out).not.toContain("In this thread")
  })

  it("in a thread adds what the thread says of the paper: its groups, what it is, the answer, the passage and how it was found", () => {
    const thread = Object.values(exampleThreads()).find((c) => c.rows.some((r) => r.cells.q?.passage) && c.columns.some((col) => col.groups?.length))!
    const row = thread.rows.find((r) => r.cells.q?.passage && r.in)!
    const withIs: ThreadRead = { ...thread, rows: thread.rows.map((r) => (r.id === row.id ? { ...r, is: "Lab study, 12 readers", foundBy: "search: citation context" } : r)) }
    const out = html(<RowPeek thread={withIs} row={withIs.rows.find((r) => r.id === row.id)!} library={undefined} />)
    expect(out).toContain("In this thread")
    const grouping = thread.columns.find((col) => col.groups?.length)!
    const group = grouping.groups!.find((g) => row.in![grouping.id]!.includes(g.id))!
    expect(out).toContain(group.name)
    expect(out).toContain("Lab study, 12 readers")
    expect(out).toContain(row.cells.q!.text)
    expect(out).toContain(row.cells.q!.passage!.quote)
    expect(out).toContain(`Open at p. ${row.cells.q!.passage!.page}`)
    expect(out).toContain("Found: search: citation context")
    expect(out).toContain(row.paper.authors[0])
  })
})
