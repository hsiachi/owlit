import type { PaperIds, PaperKind } from "@owlit/protocol"

// What one metadata service says about a paper. Every field is optional: services disagree and fall
// silent in different places, and resolve() merges them field by field.
export interface SourceRecord {
  source: "openalex" | "s2" | "arxiv"
  ids: PaperIds
  title?: string
  authors?: string[]
  year?: number
  // ISO date of first publication, when the service has it
  date?: string
  venue?: string
  abstract?: string
  kind?: PaperKind
  // Open-access PDF links this service knows, best first; paper.pdf tries them
  pdfUrls?: string[]
  // Semantic Scholar's one-sentence summary
  tldr?: string
  citationCount?: number
  // The response as it came, kept in the paper's sources/
  raw: string
}
