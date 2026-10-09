import type { LibraryClient } from "./client"
import { parseRef } from "./lib/ref"
import { knownRefs } from "./mocks/refs"
import type { Paper, ResolvedPaper } from "./types"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class MockLibraryClient implements LibraryClient {
  async resolve(input: string): Promise<ResolvedPaper> {
    await delay(500)
    const ref = parseRef(input)
    if (!ref.arxiv && !ref.doi && !ref.url) {
      throw new Error("That does not look like a DOI, an arXiv id or a URL.")
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

  async fetchPdf(paper: Paper): Promise<Paper["pdf"]> {
    await delay(800)
    if (paper.ids.arxiv) return { url: `https://arxiv.org/pdf/${paper.ids.arxiv}` }
    throw new Error("No open-access PDF was found for this paper.")
  }
}
