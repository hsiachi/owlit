import { RpcErrorCode, type LibrarySettings, type PaperRecord, type ResolvedPaper } from "@owlit/protocol"
import { HttpError, type Http } from "../net/http.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type TaskDefinition } from "../tasks/index.ts"
import { keepSources, PaperIndex, readRecord, recordFrom, writeRecord } from "./records.ts"
import { parseRef, refOfIds } from "./refs.ts"
import { NotAPaper, resolve, type Resolution } from "./resolve.ts"

// How long a looked-up paper is kept, so adding it right after doesn't ask the services again
const RESOLUTION_TTL_MS = 10 * 60_000

export interface LibraryServices {
  http: Http
  // Read at each use, so a key the user adds applies at once
  settings: () => Promise<LibrarySettings>
}

// The workspace's papers: library/papers/ (what each paper is) and .owlit/papers/ (what the user
// thinks of it)
export class Library {
  readonly root: string
  readonly index: PaperIndex
  private readonly services: LibraryServices
  private resolutions = new Map<string, { resolution: Resolution; at: number }>()

  constructor(root: string, services: LibraryServices) {
    this.root = root
    this.services = services
    this.index = new PaperIndex(root)
  }

  // What a reference means, and whether the library already has it. Asks the services directly rather
  // than as a task: someone is waiting, nothing is written, and each service's rate still holds.
  async resolve(input: string, signal?: AbortSignal): Promise<{ paper: ResolvedPaper; existingId?: string }> {
    const ref = parseRef(input)
    if (ref && ref.kind !== "url") {
      // The library may know it without asking anyone
      const existingId = await this.index.find({ [ref.kind]: ref.value })
      const record = existingId ? await readRecord(this.root, existingId) : undefined
      if (existingId && record) return { paper: { id: existingId, ...pick(record) }, existingId }
    }
    let resolution: Resolution
    try {
      resolution = await resolve(this.services.http, ref ?? input, await this.services.settings(), { signal, retries: 1 })
    } catch (error) {
      throw asRpcFailure(error)
    }
    this.remember(resolution)
    const existingId = await this.index.find(resolution.ids)
    return { paper: { id: resolution.id, ...pick(resolution) }, existingId }
  }

  // For each input, the paper in the library it names, offline
  async known(inputs: string[]): Promise<(string | null)[]> {
    return Promise.all(
      inputs.map(async (input) => {
        const ref = parseRef(input)
        if (!ref || ref.kind === "url") return null
        return (await this.index.find({ [ref.kind]: ref.value })) ?? null
      }),
    )
  }

  // A resolution looked up a moment ago, so add() can write it whole
  recent(id: string): Resolution | undefined {
    const kept = this.resolutions.get(id)
    return kept && Date.now() - kept.at < RESOLUTION_TTL_MS ? kept.resolution : undefined
  }

  tasks(): TaskDefinition[] {
    return [
      // Asks the services about a paper already in the library and rewrites its paper.json
      defineTask("paper.metadata", {
        lane: "network",
        run: async (ctx) => {
          const id = ctx.task.subject
          const record = await readRecord(this.root, id)
          if (!record) throw new TaskFailure(`${id} is not in the library.`)
          const ref = refOfIds(record.ids)
          // A file nobody has identified: there is nobody to ask
          if (!ref) return
          let resolution = this.recent(id)
          if (!resolution) {
            try {
              resolution = await resolve(this.services.http, ref, await this.services.settings(), { signal: ctx.signal })
            } catch (error) {
              if (error instanceof NotAPaper) throw new TaskFailure(error.message)
              throw error
            }
          }
          await keepSources(this.root, id, resolution.records)
          const next = recordFrom(id, resolution, record)
          await writeRecord(this.root, next)
          this.index.set(id, next.ids)
        },
      }),
    ]
  }

  private remember(resolution: Resolution) {
    const now = Date.now()
    for (const [id, kept] of this.resolutions) if (now - kept.at >= RESOLUTION_TTL_MS) this.resolutions.delete(id)
    this.resolutions.set(resolution.id, { resolution, at: now })
  }
}

function pick(from: Resolution | PaperRecord): Omit<ResolvedPaper, "id"> {
  return {
    title: from.title,
    authors: from.authors,
    ids: from.ids,
    year: from.year,
    venue: from.venue,
    abstract: from.abstract,
    kind: from.kind,
  }
}

function asRpcFailure(error: unknown) {
  if (error instanceof NotAPaper) return new RpcFailure(RpcErrorCode.NotFound, error.message)
  if (error instanceof HttpError) return new RpcFailure(RpcErrorCode.Unavailable, error.message, { status: error.status })
  return error
}
