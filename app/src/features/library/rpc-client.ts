import type { LibraryClient, Resolved } from "./client"
import type { Paper } from "@owlit/protocol"
import { filePath, rpc } from "@/lib/rpc"

// The library client: lookups and PDFs go to core
export class RpcLibraryClient implements LibraryClient {
  async resolve(input: string): Promise<Resolved> {
    const { paper, existingId, learned } = await rpc.library.resolve({ input })
    return { ...paper, existingId, ...(learned ? { learned } : {}) }
  }

  // Waits while core looks; the paper comes back with its PDF or with where getting it stands
  async fetchPdf(paper: Paper): Promise<Pick<Paper, "pdf" | "pdfState">> {
    const { pdf, pdfState } = await rpc.library.fetchPdf({ id: paper.id })
    return { pdf, pdfState }
  }

  async attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]> {
    const attached = await rpc.library.attachPdf({ id: paper.id, path: filePath(file) })
    return attached.pdf
  }
}
