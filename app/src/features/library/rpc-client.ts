import { PublisherNeedsUser, type LibraryClient, type Resolved } from "./client"
import type { Paper } from "./types"
import { filePath, rpc } from "@/lib/rpc"

// The desktop app's library client: lookups and PDFs go to core
export class RpcLibraryClient implements LibraryClient {
  async resolve(input: string): Promise<Resolved> {
    const { paper, existingId } = await rpc.library.resolve({ input })
    return { ...paper, existingId }
  }

  // Waits while core looks; a paper still without a PDF rejects with what was tried
  async fetchPdf(paper: Paper): Promise<Paper["pdf"]> {
    const found = await rpc.library.fetchPdf({ id: paper.id })
    if (found.pdf) return found.pdf
    if (found.noPdf?.needs) throw new PublisherNeedsUser(found.noPdf.needs)
    throw new Error(found.noPdf ? "No PDF found. Drop one here if you have it." : "owlit couldn't look for a PDF.")
  }

  checkPublisher(paper: Paper): Promise<Paper> {
    return rpc.library.checkPublisher({ id: paper.id })
  }

  openInBrowser(paper: Paper): Promise<Paper> {
    return rpc.library.openInBrowser({ id: paper.id })
  }

  takeDownload(paper: Paper, take: boolean): Promise<Paper> {
    return rpc.library.takeDownload({ id: paper.id, take })
  }

  async attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]> {
    const attached = await rpc.library.attachPdf({ id: paper.id, path: filePath(file) })
    return attached.pdf
  }
}
