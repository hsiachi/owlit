import type { LibraryClient, Resolved } from "./client"
import { MockLibraryClient } from "./mock-client"
import type { Paper } from "./types"
import { rpc } from "@/lib/rpc"

// The desktop app's library client: lookups go to core (OpenAlex, Semantic Scholar, arXiv). Dropped
// files and finding PDFs still use the mock until core does them.
export class RpcLibraryClient implements LibraryClient {
  private mock = new MockLibraryClient()

  async resolve(input: string): Promise<Resolved> {
    const { paper, existingId } = await rpc.library.resolve({ input })
    return { ...paper, existingId }
  }

  importPdf(file: File) {
    return this.mock.importPdf(file)
  }

  fetchPdf(paper: Paper) {
    return this.mock.fetchPdf(paper)
  }
}
