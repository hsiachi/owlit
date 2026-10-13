import { t } from "@lingui/core/macro"
import { isMarkdown, isWithin, RpcErrorCode, type DocShare, type ShareComment, type SharePermission } from "@owlit/protocol"
import { createHash } from "node:crypto"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import type { SecretBox } from "../host.ts"
import { RpcFailure } from "../rpc/index.ts"
import { buildBundle, type PaperSource } from "./bundle.ts"
import { ShareClient, ShareError } from "./client.ts"

// The workspace's shared docs. Which doc has which link is kept in .owlit/shares.json, so it travels with
// the folder; the key that lets this computer change a link is kept on this computer only (the workspace's
// data directory, sealed when the host can seal), since anyone holding it could rewrite what readers see.
// Readers' comments are kept beside the links (.owlit/shares/<id>.json), so they stay with the doc even
// if the server goes away.
//
// Every change to the workspace calls touched(); once things settle, each shared doc is built again and
// pushed if it reads differently from what the server has. Comments are fetched every little while.

interface ShareRecord {
  id: string
  path: string
  url: string
  server: string
  permission: SharePermission
  notes: boolean
  createdAt: number
  pushedAt?: number
  // What the server has, so an unchanged doc isn't pushed again
  pushedHash?: string
  papers: number
}

interface SharesFile {
  version: 1
  shares: ShareRecord[]
}

interface KeysFile {
  version: 1
  keys: Record<string, string | { sealed: string }>
}

interface CommentsFile {
  version: 1
  comments: ShareComment[]
}

export interface SharesServices {
  owlitDir: string
  dataDir: string
  // Where new links are made; null when no server is set up
  server: () => string | null
  fetch?: typeof fetch
  secrets?: SecretBox
  readDoc: (path: string) => Promise<string | null>
  paper: (id: string) => Promise<PaperSource | undefined>
  // The profile's name, which signs the bundle and the author's replies
  author: () => Promise<string | undefined>
  changed: (path: string, share: DocShare | null) => void
  commentsChanged: (path: string, comments: ShareComment[]) => void
  // How long changes settle before a push, and how often comments are fetched (tests shorten both)
  settleMs?: number
  pollMs?: number
}

const SETTLE_MS = 1500
const POLL_MS = 30_000

const hashOf = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex")

export class Shares {
  private readonly services: SharesServices
  private records: ShareRecord[] | undefined
  private keys: Map<string, string> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  // Why a share's latest changes haven't reached the server, by share id
  private problems = new Map<string, string>()
  private comments = new Map<string, ShareComment[]>()
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private disposed = false

  constructor(services: SharesServices) {
    this.services = services
  }

  // Loads the shares and starts following them
  async start() {
    await this.serial(async () => {
      await this.load()
      this.follow()
    })
    // What changed while owlit was closed goes out now, and comments left meanwhile come in
    this.touched()
    void this.poll()
  }

  list() {
    return this.serial(async () => {
      const records = await this.load()
      return { server: this.services.server(), shares: await Promise.all(records.map((r) => this.view(r))) }
    })
  }

  create(docPath: string, notes: boolean) {
    return this.serial(async () => {
      const records = await this.load()
      const existing = records.find((r) => r.path === docPath)
      if (existing) return this.view(existing)
      const server = this.services.server()
      if (!server) throw new RpcFailure(RpcErrorCode.Unavailable, t`No share server is set up, so owlit can't make links yet.`)
      if (!isMarkdown(docPath)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Only docs can be shared.`)
      const markdown = await this.services.readDoc(docPath)
      if (markdown === null) throw new RpcFailure(RpcErrorCode.NotFound, t`There is no ${docPath} in the workspace.`, { path: docPath })
      const bundle = await buildBundle({ path: docPath, markdown, notes, author: await this.services.author(), paper: this.services.paper })
      const made = await this.client(server)
        .create(bundle, "comment")
        .catch((error) => {
          throw asFailure(error)
        })
      const now = Date.now()
      const record: ShareRecord = {
        id: made.id,
        path: docPath,
        url: made.url,
        server,
        permission: "comment",
        notes,
        createdAt: now,
        pushedAt: now,
        pushedHash: hashOf(bundle),
        papers: Object.keys(bundle.papers).length,
      }
      ;(await this.loadKeys()).set(made.id, made.token)
      await this.saveKeys()
      records.push(record)
      await this.save()
      this.follow()
      const view = await this.view(record)
      this.services.changed(docPath, view)
      return view
    })
  }

  update(docPath: string, change: { permission?: SharePermission; notes?: boolean }) {
    return this.serial(async () => {
      const record = await this.mine(docPath)
      const token = (await this.loadKeys()).get(record.id)!
      if (change.permission && change.permission !== record.permission) {
        await this.client(record.server)
          .update(record.id, token, { permission: change.permission })
          .catch((error) => this.failed(record, error))
        record.permission = change.permission
      }
      if (change.notes !== undefined && change.notes !== record.notes) {
        record.notes = change.notes
        await this.push(record, token).catch((error) => this.failed(record, error))
      }
      await this.save()
      const view = await this.view(record)
      this.services.changed(record.path, view)
      return view
    })
  }

  stop(docPath: string) {
    return this.serial(async () => {
      const record = await this.mine(docPath)
      const token = (await this.loadKeys()).get(record.id)!
      await this.client(record.server)
        .stop(record.id, token)
        .catch((error) => {
          // Already stopped there is stopped all the same
          if (!(error instanceof ShareError && error.gone)) throw asFailure(error)
        })
      await this.forget(record)
      return null
    })
  }

  commentsOf(docPath: string) {
    return this.serial(async () => {
      const record = (await this.load()).find((r) => r.path === docPath)
      if (!record) return []
      await this.fetchComments(record).catch(() => undefined)
      return this.comments.get(record.id) ?? (await this.loadComments(record.id))
    })
  }

  reply(docPath: string, parent: string, text: string) {
    return this.serial(async () => {
      const record = await this.mine(docPath)
      const token = (await this.loadKeys()).get(record.id)!
      const name = (await this.services.author()) || t`The author`
      const comment = await this.client(record.server)
        .reply(record.id, token, { parent, name, text })
        .catch((error) => this.failed(record, error))
      await this.keepComments(record, [...(this.comments.get(record.id) ?? (await this.loadComments(record.id))), comment])
      return comment
    })
  }

  resolve(docPath: string, id: string, resolved: boolean) {
    return this.serial(async () => {
      const record = await this.mine(docPath)
      const token = (await this.loadKeys()).get(record.id)!
      await this.client(record.server)
        .resolve(record.id, token, id, resolved)
        .catch((error) => this.failed(record, error))
      const comments = (this.comments.get(record.id) ?? (await this.loadComments(record.id))).map((c) => (c.id === id ? withResolved(c, resolved) : c))
      await this.keepComments(record, comments)
      return null
    })
  }

  // Something in the workspace changed: once things settle, every shared doc that now reads differently goes out
  touched() {
    if (this.disposed) return
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => void this.pushAll(), this.services.settleMs ?? SETTLE_MS)
  }

  // A doc or folder was renamed or moved: its shares go with it
  moved(from: string, to: string) {
    return this.serial(async () => {
      const records = await this.load()
      let any = false
      for (const record of records) {
        if (record.path !== from && !isWithin(record.path, from)) continue
        const before = record.path
        record.path = to + record.path.slice(from.length)
        any = true
        this.services.changed(before, null)
        this.services.changed(record.path, await this.view(record))
      }
      if (any) await this.save()
    })
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.settleTimer)
    clearInterval(this.pollTimer)
  }

  // ---- inside

  private pushAll() {
    return this.serial(async () => {
      const keys = await this.loadKeys()
      for (const record of [...(await this.load())]) {
        const token = keys.get(record.id)
        if (token) await this.push(record, token).catch(() => undefined)
      }
      await this.save()
    })
  }

  // Builds the doc's bundle again and sends it when it differs from what the server has
  private async push(record: ShareRecord, token: string) {
    const markdown = await this.services.readDoc(record.path)
    if (markdown === null) {
      this.setProblem(record, t`The doc isn't in the workspace any more, so readers see it as it last was.`)
      return
    }
    const bundle = await buildBundle({ path: record.path, markdown, notes: record.notes, author: await this.services.author(), paper: this.services.paper })
    const hash = hashOf(bundle)
    if (hash === record.pushedHash && !this.problems.has(record.id)) return
    try {
      if (hash !== record.pushedHash) await this.client(record.server).update(record.id, token, { bundle })
    } catch (error) {
      if (error instanceof ShareError && error.gone) {
        await this.forget(record)
        return
      }
      this.setProblem(record, error instanceof Error ? error.message : String(error))
      throw error
    }
    record.pushedHash = hash
    record.pushedAt = Date.now()
    record.papers = Object.keys(bundle.papers).length
    this.problems.delete(record.id)
    this.services.changed(record.path, await this.view(record))
  }

  private setProblem(record: ShareRecord, problem: string) {
    if (this.problems.get(record.id) === problem) return
    this.problems.set(record.id, problem)
    void this.view(record).then((view) => this.services.changed(record.path, view))
  }

  // Comments every little while, and another try for changes that couldn't be pushed
  private follow() {
    if (this.pollTimer || !this.records?.length || this.disposed) return
    this.pollTimer = setInterval(() => void this.poll(), this.services.pollMs ?? POLL_MS)
    this.pollTimer.unref?.()
  }

  private poll() {
    return this.serial(async () => {
      const records = await this.load()
      for (const record of records) await this.fetchComments(record).catch(() => undefined)
      if (this.problems.size) this.touched()
    })
  }

  private async fetchComments(record: ShareRecord) {
    const token = (await this.loadKeys()).get(record.id)
    const comments = await this.client(record.server).comments(record.id, token)
    await this.keepComments(record, comments)
  }

  private async keepComments(record: ShareRecord, comments: ShareComment[]) {
    const before = this.comments.get(record.id) ?? (await this.loadComments(record.id))
    this.comments.set(record.id, comments)
    if (hashOf(before) === hashOf(comments)) return
    await writeJsonAtomic(this.commentsFile(record.id), { version: 1, comments } satisfies CommentsFile)
    this.services.commentsChanged(record.path, comments)
  }

  private async loadComments(id: string) {
    const stored = await readJson<CommentsFile>(this.commentsFile(id)).catch(() => undefined)
    const comments = stored?.comments ?? []
    this.comments.set(id, comments)
    return comments
  }

  private async forget(record: ShareRecord) {
    const records = await this.load()
    records.splice(records.indexOf(record), 1)
    ;(await this.loadKeys()).delete(record.id)
    this.problems.delete(record.id)
    this.comments.delete(record.id)
    await this.save()
    await this.saveKeys()
    this.services.changed(record.path, null)
    if (!records.length) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  // A share this computer can change
  private async mine(docPath: string) {
    const record = (await this.load()).find((r) => r.path === docPath)
    if (!record) throw new RpcFailure(RpcErrorCode.NotFound, t`${docPath} isn't shared.`, { path: docPath })
    if (!(await this.loadKeys()).has(record.id)) throw new RpcFailure(RpcErrorCode.Conflict, t`This doc was shared from another computer; only that one can change its link.`)
    return record
  }

  private failed(record: ShareRecord, error: unknown): never {
    if (error instanceof ShareError && error.gone) void this.serialFree(() => this.forget(record))
    throw asFailure(error)
  }

  // Runs after the current queued work, for cleanup a failing call asks for
  private serialFree(work: () => Promise<unknown>) {
    return this.queue.then(work).catch(() => undefined)
  }

  private async view(record: ShareRecord): Promise<DocShare> {
    const keys = await this.loadKeys()
    const problem = this.problems.get(record.id)
    return {
      path: record.path,
      id: record.id,
      url: record.url,
      permission: record.permission,
      notes: record.notes,
      createdAt: record.createdAt,
      ...(record.pushedAt ? { pushedAt: record.pushedAt } : {}),
      ...(problem ? { problem } : {}),
      papers: record.papers,
      ...(keys.has(record.id) ? {} : { foreign: true }),
    }
  }

  private client(server: string) {
    return new ShareClient(server, this.services.fetch)
  }

  private get sharesFile() {
    return path.join(this.services.owlitDir, "shares.json")
  }

  private commentsFile(id: string) {
    return path.join(this.services.owlitDir, "shares", `${id}.json`)
  }

  private get keysFile() {
    return path.join(this.services.dataDir, "share-keys.json")
  }

  private async load() {
    if (!this.records) {
      const stored = await readJson<SharesFile>(this.sharesFile).catch((error) => {
        console.error("[core] .owlit/shares.json is unreadable; no doc counts as shared", error)
        return undefined
      })
      this.records = stored?.shares ?? []
    }
    return this.records
  }

  private save() {
    return writeJsonAtomic(this.sharesFile, { version: 1, shares: this.records ?? [] } satisfies SharesFile)
  }

  private async loadKeys() {
    if (!this.keys) {
      const stored = await readJson<KeysFile>(this.keysFile).catch(() => undefined)
      this.keys = new Map()
      for (const [id, value] of Object.entries(stored?.keys ?? {})) {
        try {
          this.keys.set(id, typeof value === "string" ? value : this.services.secrets!.open(value.sealed))
        } catch (error) {
          // A key sealed on another computer can't be opened here; the link is then that computer's to change
          console.error("[core] a share's key couldn't be opened and is left out", error)
        }
      }
    }
    return this.keys
  }

  private async saveKeys() {
    const keys: KeysFile["keys"] = {}
    for (const [id, token] of await this.loadKeys()) {
      let sealed: string | undefined
      try {
        sealed = this.services.secrets?.seal(token)
      } catch (error) {
        console.error("[core] a share's key couldn't be sealed and is written as is", error)
      }
      keys[id] = sealed ? { sealed } : token
    }
    await writeJsonAtomic(this.keysFile, { version: 1, keys } satisfies KeysFile)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }
}

const withResolved = (comment: ShareComment, resolved: boolean): ShareComment => {
  if (resolved) return { ...comment, resolved: true }
  const { resolved: _, ...rest } = comment
  return rest
}

function asFailure(error: unknown) {
  if (error instanceof ShareError) return new RpcFailure(error.gone ? RpcErrorCode.NotFound : RpcErrorCode.Unavailable, error.message)
  return error
}
