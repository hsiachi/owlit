import { t } from "@lingui/core/macro"
import type { LibraryClient } from "./client"
import { parseRef } from "./lib/ref"
import type { Paper, ResolvedPaper } from "@owlit/protocol"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// References the mock resolver knows; paste one of these ids into Add to get full metadata
const knownRefs: ResolvedPaper[] = [
  {
    title: "Tree of Thoughts: Deliberate Problem Solving with Large Language Models",
    authors: ["Shunyu Yao", "Dian Yu", "Jeffrey Zhao", "Izhak Shafran", "Thomas L. Griffiths", "Yuan Cao", "Karthik Narasimhan"],
    year: 2023,
    venue: "NeurIPS",
    abstract: "Extends chain-of-thought prompting into a search over intermediate thoughts, letting a model explore, evaluate and backtrack over alternative reasoning paths.",
    ids: { arxiv: "2305.10601" },
    pdf: { url: "https://arxiv.org/pdf/2305.10601" },
  },
  {
    title: "Sensecape: Enabling Multilevel Exploration and Sensemaking with Large Language Models",
    authors: ["Sangho Suh", "Bryan Min", "Srishti Palani", "Haijun Xia"],
    year: 2023,
    venue: "UIST",
    abstract: "A canvas-based interface that lets people organise LLM responses spatially and at several levels of abstraction while exploring a topic.",
    ids: { doi: "10.1145/3586183.3606756", arxiv: "2305.11483" },
    pdf: { url: "https://arxiv.org/pdf/2305.11483" },
  },
]

export class MockLibraryClient implements LibraryClient {
  async resolve(input: string): Promise<ResolvedPaper> {
    await delay(500)
    const ref = parseRef(input)
    if (!ref.arxiv && !ref.doi && !ref.url) {
      throw new Error(t`That does not look like a DOI, an arXiv id or a URL.`)
    }
    const known = knownRefs.find(
      (k) => (ref.arxiv && k.ids.arxiv === ref.arxiv) || (ref.doi && k.ids.doi?.toLowerCase() === ref.doi.toLowerCase()),
    )
    if (known) return known
    // Unknown reference: keep the ids, leave the rest for the user to fill in
    if (ref.arxiv) {
      return {
        title: `arXiv:${ref.arxiv}`,
        authors: [],
        ids: { arxiv: ref.arxiv },
        pdf: { url: `https://arxiv.org/pdf/${ref.arxiv}` },
      }
    }
    if (ref.doi) return { title: `doi:${ref.doi}`, authors: [], ids: { doi: ref.doi } }
    let host = ref.url!
    try {
      host = new URL(ref.url!).hostname
    } catch {
      // keep the raw string
    }
    return { title: `Paper from ${host}`, authors: [], ids: { url: ref.url } }
  }

  async importPdf(file: File): Promise<ResolvedPaper> {
    await delay(300)
    const title = file.name
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return {
      title: title || "Untitled PDF",
      authors: [],
      ids: {},
      pdf: { url: URL.createObjectURL(file) },
    }
  }

  async attachPdf(_paper: Paper, file: File): Promise<Paper["pdf"]> {
    return { url: URL.createObjectURL(file) }
  }

  // An arXiv paper's PDF; any other paper found nowhere, with the next look a day away
  async fetchPdf(paper: Paper): Promise<Pick<Paper, "pdf" | "pdfState">> {
    await delay(800)
    if (paper.ids.arxiv) return { pdf: { url: `https://arxiv.org/pdf/${paper.ids.arxiv}` } }
    const look = { by: "search" as const, ended: "no-copy" as const, at: Date.now(), route: "unpaywall/repository" }
    return { pdfState: { state: "no-pdf", tried: [...(paper.pdfState?.tried ?? []), look], reason: look, nextLook: Date.now() + 24 * 60 * 60 * 1000 } }
  }
}
