import type { LibraryClient, Resolved } from "./client"
import { MockLibraryClient } from "./mock-client"
import type { Paper } from "./types"
import { rpc } from "@/lib/rpc"

// The desktop app's library client: lookups and PDFs go to core. Recognising a dropped file still uses
// the mock until core does it (T19).
export class RpcLibraryClient implements LibraryClient {
  private mock = new MockLibraryClient()

  async resolve(input: string): Promise<Resolved> {
    const { paper, existingId } = await rpc.library.resolve({ input })
    return { ...paper, existingId }
  }

  importPdf(file: File) {
    return this.mock.importPdf(file)
  }

  // Waits while core looks; a paper still without a PDF rejects with what was tried
  async fetchPdf(paper: Paper): Promise<Paper["pdf"]> {
    const found = await rpc.library.fetchPdf({ id: paper.id })
    if (found.pdf) return found.pdf
    throw new Error(found.noPdf ? "No PDF found. Drop one here if you have it." : "owlit couldn't look for a PDF.")
  }

  async attachPdf(paper: Paper, file: File): Promise<Paper["pdf"]> {
    const path = window.owlit?.pathForFile(file)
    if (!path) throw new Error("That file can't be read from here.")
    const attached = await rpc.library.attachPdf({ id: paper.id, path })
    return attached.pdf
  }
}
