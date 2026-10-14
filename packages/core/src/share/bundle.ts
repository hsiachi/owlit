import { baseName, citedPaperIds, shareableMarkdown, type Paper, type ShareBundle, type SharedPaper } from "@owlit/protocol"

// What a shared doc's reader gets: the doc, and each paper it cites with Owlit's digest and, when the author
// lets them, the author's note. Everything passes through shareableMarkdown, so nothing that points into
// the workspace leaves it.

export interface PaperSource {
  paper: Paper
  digest: string | null
  note: string | null
}

export interface BundleInput {
  path: string
  markdown: string
  author?: string
  notes: boolean
  paper: (id: string) => Promise<PaperSource | undefined>
}

// Where a paper is read: its DOI, its arXiv page, else the address it came from
export function paperLink(paper: Paper): string | undefined {
  if (paper.ids.doi) return `https://doi.org/${paper.ids.doi}`
  if (paper.ids.arxiv) return `https://arxiv.org/abs/${paper.ids.arxiv}`
  return paper.ids.url && /^https?:\/\//i.test(paper.ids.url) ? paper.ids.url : undefined
}

export async function buildBundle(input: BundleInput): Promise<ShareBundle> {
  const found = new Map<string, PaperSource>()
  for (const id of citedPaperIds(input.markdown)) {
    const source = await input.paper(id)
    if (source) found.set(id, source)
  }
  const shared = (id: string) => found.has(id)
  const papers: Record<string, SharedPaper> = {}
  for (const [id, { paper, digest, note }] of found) {
    const url = paperLink(paper)
    papers[id] = {
      id,
      title: paper.title,
      authors: paper.authors,
      ...(paper.year ? { year: paper.year } : {}),
      ...(paper.venue ? { venue: paper.venue } : {}),
      ...(url ? { url } : {}),
      ...(digest?.trim() ? { digest: shareableMarkdown(digest, shared) } : {}),
      ...(input.notes && note?.trim() ? { note: shareableMarkdown(note, shared) } : {}),
    }
  }
  return {
    version: 1,
    title: baseName(input.path).replace(/\.md$/i, ""),
    ...(input.author ? { author: input.author } : {}),
    markdown: shareableMarkdown(input.markdown, shared),
    papers,
  }
}
