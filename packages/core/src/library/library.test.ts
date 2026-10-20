import { RpcErrorCode, type PaperRecord } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { Http } from "../net/http.ts"
import { eventually, until } from "../test-util.ts"
import { Workspace } from "../workspace/workspace.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")

const cores: { dispose(): Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

// A core whose network serves recorded responses
async function setup(routes: Record<string, string | number>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-library-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(url)
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    return typeof match[1] === "number" ? new Response("", { status: match[1] }) : new Response(match[1])
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  // As owlit-mcp calls for a chat's agent, over the socket
  const agent = (method: string, params: { chatId: string } & Record<string, unknown>) => call(method, params, { kind: "socket", chatId: params.chatId })
  await call("workspace.open", { path: root })
  return { root, call, agent, asked, core }
}

const published = {
  "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
  "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
}

function putPaper(root: string, record: Partial<PaperRecord> & { id: string }) {
  const dir = path.join(root, "library/papers", record.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, title: "?", authors: [], fields: {}, ...record }))
}

describe("library over RPC", () => {
  it("resolves a pasted DOI link into a preview with its library id", async () => {
    const { call } = await setup(published)
    const { paper, existingId } = await call("library.resolve", { input: "https://doi.org/10.1145/3626772.3657891" })
    expect(existingId).toBeUndefined()
    expect(paper).toMatchObject({ id: "doi-10.1145-3626772.3657891", year: 2024, kind: "conference", ids: { arxiv: "2403.17859" } })
  })

  it("finds a paper the library has under another of its ids, without asking anyone", async () => {
    const { root, call, asked } = await setup({})
    putPaper(root, { id: "arxiv-2403.17859", title: "ChroniclingAmericaQA", ids: { arxiv: "2403.17859", doi: "10.1145/3626772.3657891" } })
    const { existingId, paper } = await call("library.resolve", { input: "10.1145/3626772.3657891" })
    expect(existingId).toBe("arxiv-2403.17859")
    expect(paper.title).toBe("ChroniclingAmericaQA")
    expect(asked).toEqual([])
    expect(await call("library.known", { inputs: ["arXiv:2403.17859v2", "10.9999/x", "words"] })).toEqual(["arxiv-2403.17859", null, null])
  })

  it("answers in sentences when it can't", async () => {
    const { call } = await setup({ "api.openalex.org": 503, "api.semanticscholar.org": 503 })
    await expect(call("library.resolve", { input: "hello there" })).rejects.toMatchObject({ code: RpcErrorCode.NotFound })
    await expect(call("library.resolve", { input: "10.1145/3626772.3657891" })).rejects.toMatchObject({
      code: RpcErrorCode.Unavailable,
      message: "api.openalex.org is having trouble right now.",
    })
  })

  it("paper.metadata rewrites paper.json, keeps the sources and keeps fields the services lack", async () => {
    const { root, core } = await setup(published)
    putPaper(root, { id: "doi-10.1145-3626772.3657891", title: "Old title", ids: { doi: "10.1145/3626772.3657891" }, venue: "kept?" })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    const done = await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")
    expect(done.state).toBe("done")
    const dir = path.join(root, "library/papers/doi-10.1145-3626772.3657891")
    const record = JSON.parse(readFileSync(path.join(dir, "paper.json"), "utf8")) as PaperRecord
    expect(record).toMatchObject({
      id: "doi-10.1145-3626772.3657891",
      ids: { doi: "10.1145/3626772.3657891", arxiv: "2403.17859", openalex: "W4393248081" },
      year: 2024,
      kind: "conference",
      fields: { title: "openalex", tldr: "s2" },
      pdfUrls: ["https://arxiv.org/pdf/2403.17859"],
    })
    expect(record.title).toMatch(/^ChroniclingAmericaQA/)
    expect(record.fetchedAt).toBeGreaterThan(0)
    expect(existsSync(path.join(dir, "sources/openalex.json"))).toBe(true)
    expect(existsSync(path.join(dir, "sources/s2.json"))).toBe(true)
  })

  it("adds a paper an arXiv search found as published work, once the services are asked", async () => {
    // arXiv knows the preprint (2023) and its published DOI; OpenAlex knows the published paper (2024)
    const feed = `<feed><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/2403.17859v1</id><published>2023-03-26T00:00:00Z</published><title>ChroniclingAmericaQA (preprint)</title><summary>Preprint abstract.</summary><author><name>Bhawna Piryani</name></author><arxiv:doi>10.1145/3626772.3657891</arxiv:doi></entry></feed>`
    const { root, call } = await setup({ ...published, "export.arxiv.org/api/query?search_query": feed })
    const found = await call("library.searchOnline", { q: "newspaper question answering", source: "arxiv" })
    expect(found.papers[0]).toMatchObject({ id: "doi-10.1145-3626772.3657891", year: 2023 })
    // Adding it asks the services, so the agent learns (and cites) the published year
    const { paper } = await call("library.resolve", { input: "doi-10.1145-3626772.3657891" })
    expect(paper).toMatchObject({ year: 2024, kind: "conference" })
    await call("library.add", { paper })
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.json"), "utf8")) as PaperRecord
    expect(record).toMatchObject({ year: 2024, kind: "conference", fields: { year: "openalex", title: "openalex" } })
  })

  it("adds a partial search result as it is when the services can't be reached, and asks them later", async () => {
    const feed = `<feed><entry><id>http://arxiv.org/abs/2403.17859v1</id><published>2023-03-26T00:00:00Z</published><title>ChroniclingAmericaQA (preprint)</title><author><name>Bhawna Piryani</name></author><arxiv:doi>10.1145/3626772.3657891</arxiv:doi></entry></feed>`
    const routes: Record<string, string | number> = { "export.arxiv.org/api/query?search_query": feed, "api.openalex.org": 503, "api.semanticscholar.org": 503 }
    const { root, core, call } = await setup(routes)
    await call("library.searchOnline", { q: "newspaper question answering", source: "arxiv" })
    const { paper } = await call("library.resolve", { input: "doi-10.1145-3626772.3657891" })
    expect(paper).toMatchObject({ year: 2023 })
    await call("library.add", { paper })
    // The services are back
    for (const key of ["api.openalex.org", "api.semanticscholar.org"]) delete routes[key]
    Object.assign(routes, published)
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    expect((await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")).state).toBe("done")
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.json"), "utf8")) as PaperRecord
    expect(record).toMatchObject({ year: 2024, fields: { year: "openalex" } })
  })

  it("paper.metadata leaves a paper nobody can be asked about alone", async () => {
    const { root, core, asked } = await setup({})
    putPaper(root, { id: "local-abc123", title: "Scanned notes", ids: {} })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    expect((await workspace.tasks.run("paper.metadata", "local-abc123")).state).toBe("done")
    expect(asked).toEqual([])
  })
})

describe("the library in the change log", () => {
  const paper = { id: "doi-10.9999-a", title: "Paper a", authors: [], ids: { doi: "10.9999/a" } }

  it("records each field the window changes, sharing one writeId, and the person's adds and removals", async () => {
    const { call } = await setup({})
    await call("library.add", { paper })
    await call("library.update", { id: paper.id, patch: { starred: true, tags: ["replay"], title: "Paper A", position: { page: 2, y: 0 } } })
    await call("library.remove", { ids: [paper.id] })
    const all = (await call("changes.list", { target: { kind: "paper", path: paper.id } })).reverse()
    expect(all.map((c: any) => [c.action, c.target.part ?? null, c.actor.slice(0, 2), c.origin.via])).toEqual([
      ["create", null, "p_", "editor"],
      ["update", "overrides.title", "p_", "editor"],
      ["update", "starred", "p_", "editor"],
      ["update", "tags", "p_", "editor"],
      ["delete", null, "p_", "editor"],
    ])
    expect(all[1]).toMatchObject({ before: "Paper a", after: "Paper A" })
    expect(new Set(all.slice(1, 4).map((c: any) => c.origin.writeId)).size).toBe(1)
  })

  it("makes an opened paper reading on its own, as the person's change through owlit", async () => {
    const { call } = await setup({})
    await call("library.add", { paper })
    const opened = await call("library.opened", { id: paper.id })
    expect(opened).toMatchObject({ status: "reading", lastOpenedAt: expect.any(Number) })
    // Opened again: only the time moves
    await call("library.opened", { id: paper.id })
    const status = await call("changes.list", { target: { kind: "paper", part: "status" } })
    expect(status).toMatchObject([{ actor: expect.stringMatching(/^p_/), origin: { via: "auto" }, before: "unread", after: "reading" }])
  })
})

describe("keeping the library clean", () => {
  const title = "Proactive behavior in voice assistants: A systematic review and conceptual model"
  const review = { id: "doi-10.1016-j.chbr.2024.100411", title, ids: { doi: "10.1016/j.chbr.2024.100411" }, year: 2024 }
  // Semantic Scholar's stray copy: no DOI, no year; Crossref knows the DOI by the title
  const strayRoutes = {
    "graph/v1/paper/d9b08e17": JSON.stringify({ paperId: "d9b08e17", externalIds: {}, title, authors: [{ name: "C. E." }] }),
    "api.crossref.org/works?query.bibliographic": JSON.stringify({ message: { items: [{ DOI: "10.1016/j.chbr.2024.100411", title: [title], issued: { "date-parts": [[2024]] } }] } }),
  }
  const workspaceOf = (core: Core) => (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
  // Papers written straight to disk reach the library's index a moment later
  const indexed = (call: (method: string, params?: unknown) => Promise<any>, inputs: string[]) =>
    until(async () => ((await call("library.known", { inputs })) as (string | null)[]).every(Boolean), { what: "the papers in the library's index" })

  it("doesn't add a copy of a paper it has under a DOI, and records no change an agent could undo", async () => {
    const { root, call, agent } = await setup({})
    putPaper(root, review)
    await indexed(call, [review.ids.doi])
    const added = await agent("library.add", { paper: { id: "s2-d9b08e17", title, authors: [], ids: { s2: "d9b08e17" } }, chatId: "c1" })
    expect(added.id).toBe(review.id)
    expect((await call("library.list")).papers.map((p: { id: string }) => p.id)).toEqual([review.id])
    expect(await call("changes.list", { path: review.id })).toEqual([])
  })

  it("folds a stray copy into the paper with the DOI once it is looked up again, its id kept as an alias", async () => {
    const { root, core, call } = await setup(strayRoutes)
    putPaper(root, review)
    putPaper(root, { id: "s2-d9b08e17", title, ids: { s2: "d9b08e17" } })
    await indexed(call, [review.ids.doi])
    expect((await workspaceOf(core).tasks.run("paper.metadata", "s2-d9b08e17")).state).toBe("done")
    const listed = await call("library.list")
    expect(listed.papers.map((p: { id: string }) => p.id)).toEqual([review.id])
    expect(listed.aliases).toEqual({ "s2-d9b08e17": review.id })
    expect(existsSync(path.join(root, "library/papers/s2-d9b08e17"))).toBe(false)
  })

  it("keeps a copy the user has worked with, and the copy says which paper it looks like", async () => {
    const { root, core, call } = await setup(strayRoutes)
    putPaper(root, review)
    putPaper(root, { id: "s2-d9b08e17", title, ids: { s2: "d9b08e17" } })
    await call("library.update", { id: "s2-d9b08e17", patch: { starred: true } })
    await indexed(call, [review.ids.doi])
    expect((await workspaceOf(core).tasks.run("paper.metadata", "s2-d9b08e17")).state).toBe("done")
    const { papers } = await call("library.list")
    expect(papers.map((p: { id: string }) => p.id).sort()).toEqual([review.id, "s2-d9b08e17"])
    expect(papers.find((p: { id: string }) => p.id === "s2-d9b08e17").copyOf).toBe(review.id)
  })

  it("teaches a paper it has the ids a lookup found, and looks for its PDF by them", async () => {
    // arXiv's record of the preprint names the published DOI the library files the paper under
    const feed = `<feed><entry><id>http://arxiv.org/abs/2101.00001v1</id><published>2021-01-01T00:00:00Z</published><title>A paper</title><author><name>A. Author</name></author><arxiv:doi>10.9999/x</arxiv:doi></entry></feed>`
    const { root, call } = await setup({ "export.arxiv.org/api/query?id_list=2101.00001": feed, "arxiv.org/pdf/2101.00001": "%PDF-1.4\n%%EOF\n" })
    putPaper(root, { id: "doi-10.9999-x", title: "A paper", ids: { doi: "10.9999/x" } })
    const acquisition = path.join(root, "library/papers/doi-10.9999-x/acquisition.json")
    writeFileSync(acquisition, JSON.stringify({ version: 2, state: "no-pdf", tried: [{ by: "search", ended: "no-copy", at: Date.now() - 60_000 }], dropHere: "", looks: 1 }))
    await indexed(call, ["10.9999/x"])
    const looked = await call("library.resolve", { input: "arXiv:2101.00001" })
    expect(looked).toMatchObject({ existingId: "doi-10.9999-x", learned: ["arxiv"] })
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.9999-x/paper.json"), "utf8")) as PaperRecord
    expect(record.ids).toEqual({ doi: "10.9999/x", arxiv: "2101.00001" })
    await eventually(() => expect(JSON.parse(readFileSync(acquisition, "utf8"))).toMatchObject({ state: "have-it", route: "arxiv" }))
  })

  it("makes a preprint and its published version, added later under another title, one paper", async () => {
    const { root, core, call } = await setup(published)
    putPaper(root, { id: "arxiv-2403.17859", title: "Questions over a century of newspapers", ids: { arxiv: "2403.17859" } })
    await indexed(call, ["arXiv:2403.17859"])
    const doi = "doi-10.1145-3626772.3657891"
    await call("library.add", { paper: { id: doi, title: "ChroniclingAmericaQA", authors: [], ids: { doi: "10.1145/3626772.3657891" } } })
    const tasks = workspaceOf(core).tasks
    const lookup = await until(() => tasks.list().find((t) => t.kind === "paper.metadata" && t.subject === doi), { what: "the paper's lookup" })
    expect((await tasks.wait(lookup.id)).state).toBe("done")
    const listed = await call("library.list")
    expect(listed.papers.map((p: { id: string }) => p.id)).toEqual([doi])
    expect(listed.aliases).toEqual({ "arxiv-2403.17859": doi })
  })

  it("lets an agent take back only papers Owlit added that the user hasn't touched, each a change", async () => {
    const { call, agent } = await setup({})
    const paper = (id: string) => ({ id, title: `Paper ${id}`, authors: [], ids: { doi: `10.9999/${id}` } })
    await agent("library.add", { paper: paper("doi-10.9999-a"), chatId: "c1" })
    await agent("library.add", { paper: paper("doi-10.9999-b"), chatId: "c1" })
    await call("library.add", { paper: paper("doi-10.9999-c") })
    await call("library.update", { id: "doi-10.9999-b", patch: { tags: ["keep"] } })
    // A passage the agent marked itself doesn't make the paper the user's
    await call("library.putHighlight", { highlight: { id: "h", paperId: "doi-10.9999-a", page: 0, rects: [], text: "t", color: "yellow", createdAt: 1 }, chatId: "c1" })
    // The user's paper, or one they tagged, isn't Owlit's to take back: the policy says so before the library is asked
    await expect(agent("library.removeByAgent", { ids: ["doi-10.9999-c"], chatId: "c1" })).rejects.toThrow(/Not done: That paper doi-10\.9999-c is the user's, not Owlit's/)
    await expect(agent("library.removeByAgent", { ids: ["doi-10.9999-b"], chatId: "c1" })).rejects.toThrow(/Not done: The user has changed that paper since/)
    // Another chat of the same person's Owlit is the same Owlit
    const done = await agent("library.removeByAgent", { ids: ["doi-10.9999-a"], chatId: "c2" })
    expect(done).toEqual({ removed: ["doi-10.9999-a"], refused: [] })
    // The user's Undo puts it back
    const [removal] = await call("changes.list", { path: "doi-10.9999-a" })
    expect(removal).toMatchObject({ actor: expect.stringMatching(/^o_/), action: "delete", target: { kind: "paper", path: "doi-10.9999-a" }, origin: { chatId: "c2" } })
    await call("changes.undo", { id: removal.id })
    expect((await call("library.list")).papers.map((p: { id: string }) => p.id).sort()).toEqual(["doi-10.9999-a", "doi-10.9999-b", "doi-10.9999-c"])
  })

  it("looks up papers whose details predate the current checks once, when the workspace opens", async () => {
    const { root, core } = await setup(published)
    putPaper(root, { id: "doi-10.1145-3626772.3657891", title: "ChroniclingAmericaQA", ids: { doi: "10.1145/3626772.3657891" }, fetchedAt: 1 })
    putPaper(root, { id: "local-abc123", title: "Scanned notes", ids: {}, fetchedAt: 1 })
    // Written by hand: left alone
    putPaper(root, { id: "doi-10.1145-1", title: "By hand", ids: { doi: "10.1145/1" } })
    await core.dispose()
    const routes: Record<string, string> = published
    const fetch = (async (url: string) => {
      const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
      return match ? new Response(match[1]) : new Response("not found", { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), host: { fetch }, retryBaseMs: 1 })
    cores.push(again)
    await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const tasks = workspaceOf(again).tasks
    const queued = await until(() => tasks.list().find((t) => t.kind === "paper.metadata" && t.subject === "doi-10.1145-3626772.3657891"), { what: "the paper's lookup" })
    expect((await tasks.wait(queued.id)).state).toBe("done")
    expect(tasks.list().some((t) => t.kind === "paper.metadata" && (t.subject === "local-abc123" || t.subject === "doi-10.1145-1"))).toBe(false)
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.json"), "utf8")) as PaperRecord
    expect(record.checked).toBe(1)
  })

  it("looks again at the next start for a paper whose look reached nothing", async () => {
    const { root, core } = await setup({})
    putPaper(root, { id: "arxiv-1706.03762", title: "Attention", ids: { arxiv: "1706.03762" } })
    const offline = path.join(root, "library/papers/arxiv-1706.03762/acquisition.json")
    writeFileSync(offline, JSON.stringify({ version: 2, state: "finding", tried: [{ by: "search", ended: "offline", at: Date.now() - 60_000 }], dropHere: "" }))
    await core.dispose()
    // The first open looked at an empty library today; these papers came after it
    const workspaces = path.join(path.dirname(root), "userData/workspaces")
    for (const dir of readdirSync(workspaces)) rmSync(path.join(workspaces, dir, "library.json"), { force: true })
    const fetch = (async (url: string) => (url.includes("arxiv.org/pdf/1706.03762") ? new Response("%PDF-1.4\n%%EOF\n") : new Response("not found", { status: 404 }))) as unknown as typeof globalThis.fetch
    const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), host: { fetch }, retryBaseMs: 1 })
    cores.push(again)
    await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    await eventually(() => expect(JSON.parse(readFileSync(offline, "utf8"))).toMatchObject({ state: "have-it", route: "arxiv" }))
  })

  it("looks again within the hour, while owlit stays open, for a paper whose look reached nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    try {
      const { root, core } = await setup({ "arxiv.org/pdf/1706.03762": "%PDF-1.4\n%%EOF\n" })
      // The open's daily look is over before the papers come
      await workspaceOf(core).library.missingRetried
      putPaper(root, { id: "arxiv-1706.03762", title: "Attention", ids: { arxiv: "1706.03762" } })
      const offline = path.join(root, "library/papers/arxiv-1706.03762/acquisition.json")
      writeFileSync(offline, JSON.stringify({ version: 2, state: "finding", tried: [{ by: "search", ended: "offline", at: Date.now() - 60_000 }], dropHere: "" }))
      // A thread's paper nobody has read: never sought, so left alone
      putPaper(root, { id: "arxiv-2101.00001", title: "Unsought", ids: { arxiv: "2101.00001" } })
      vi.advanceTimersByTime(60 * 60_000)
      await eventually(() => expect(JSON.parse(readFileSync(offline, "utf8"))).toMatchObject({ state: "have-it", route: "arxiv" }))
      expect(existsSync(path.join(root, "library/papers/arxiv-2101.00001/acquisition.json"))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("counts citations again once a month, by OpenAlex, quietly and once a day at most", async () => {
    const { root, core } = await setup({})
    const id = "doi-10.1145-3626772.3657891"
    putPaper(root, { id, title: "ChroniclingAmericaQA", ids: { doi: "10.1145/3626772.3657891", openalex: "W4393248081" }, fetchedAt: 1, citationCount: 22, fields: { citationCount: "s2" }, checked: 1 })
    // Counted a week ago: not due
    putPaper(root, { id: "doi-10.1145-2", title: "Fresh", ids: { doi: "10.1145/2" }, fetchedAt: 1, citationCount: 5, citationsAt: Date.now() - 7 * 86_400_000, checked: 1 })
    await core.dispose()
    // The first open counted an empty library today; these papers came after it
    const workspaces = path.join(path.dirname(root), "userData/workspaces")
    for (const dir of readdirSync(workspaces)) rmSync(path.join(workspaces, dir, "library.json"), { force: true })
    const asked: string[] = []
    const fetch = (async (url: string) => {
      asked.push(url)
      if (url.includes("api.openalex.org/works?") && url.includes("W4393248081")) return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/W4393248081", doi: "https://doi.org/10.1145/3626772.3657891", cited_by_count: 31 }] }))
      return new Response("not found", { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const open = async () => {
      const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), host: { fetch }, retryBaseMs: 1 })
      cores.push(again)
      await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
      return again
    }
    const read = (paper: string) => JSON.parse(readFileSync(path.join(root, "library/papers", paper, "paper.json"), "utf8")) as PaperRecord
    const first = await open()
    await until(() => read(id).citationsAt, { what: "the recount" })
    expect(read(id)).toMatchObject({ citationCount: 31, fields: { citationCount: "openalex" } })
    expect(asked.some((u) => u.includes("10.1145%2F2") || u.includes("10.1145/2|"))).toBe(false)
    const { papers } = await first.handle({ jsonrpc: "2.0", id: 2, method: "library.list" }).then((r) => (r as { result: { papers: { id: string; citations?: unknown }[] } }).result)
    expect(papers.find((p) => p.id === id)?.citations).toMatchObject({ count: 31, source: "openalex" })
    await first.dispose()
    asked.length = 0
    const second = await open()
    // Settles once the second open's recount has found it already ran today
    await workspaceOf(second).library.citationsRecounted
    expect(asked.filter((u) => u.includes("api.openalex.org/works?"))).toEqual([])
  })
})

describe("library on disk", () => {
  const resolvedArxiv = { id: "arxiv-1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 }

  it("adds a paper as paper.json and state.json, lists it, and keeps it across a restart", async () => {
    const { root, call, core } = await setup({ "export.arxiv.org": fixture("arxiv-1706.03762.xml") })
    const paper = await call("library.add", { paper: resolvedArxiv })
    expect(paper).toMatchObject({ id: "arxiv-1706.03762", status: "unread", starred: false, addedBy: expect.stringMatching(/^p_/), tags: [] })
    expect(existsSync(path.join(root, "library/papers/arxiv-1706.03762/paper.json"))).toBe(true)
    const state = JSON.parse(readFileSync(path.join(root, ".owlit/papers/arxiv-1706.03762/state.json"), "utf8"))
    expect(state).toMatchObject({ version: 1, addedBy: paper.addedBy, status: "unread" })
    // Added twice, by another of its ids: one paper
    expect((await call("library.add", { paper: { ...resolvedArxiv, id: undefined } })).id).toBe("arxiv-1706.03762")
    await core.dispose()
    const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), retryBaseMs: 1 })
    cores.push(again)
    await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const listed = await again.handle({ jsonrpc: "2.0", id: 2, method: "library.list" })
    expect((listed as any).result.papers.map((p: { id: string }) => p.id)).toEqual(["arxiv-1706.03762"])
  })

  it("keeps the user's judgement, position, highlights and note, in readable files", async () => {
    const { root, call } = await setup({})
    await call("library.add", { paper: resolvedArxiv })
    const id = "arxiv-1706.03762"
    await call("library.update", { id, patch: { starred: true, status: "reading", tags: ["attention"], position: { page: 3, y: 120 }, lastOpenedAt: 5 } })
    await call("library.putHighlight", {
      highlight: { id: "h1", paperId: id, page: 2, rects: [{ page: 2, x: 1, y: 2, w: 3, h: 4 }], text: "scaled dot-product", color: "yellow", createdAt: 1 },
    })
    await call("library.putHighlight", {
      highlight: { id: "h1", paperId: id, page: 2, rects: [{ page: 2, x: 1, y: 2, w: 3, h: 4 }], text: "scaled dot-product", color: "green", comment: "key idea", createdAt: 1 },
    })
    const note = await call("library.setNote", { paperId: id, content: "# Notes\n\nSee [Vaswani 2017](owlit://library/arxiv-1706.03762).\n" })
    expect(note.updatedAt).toBeGreaterThan(0)

    const { papers, highlights, notes } = await call("library.list")
    expect(papers[0]).toMatchObject({ starred: true, status: "reading", tags: ["attention"], position: { page: 3, y: 120 }, lastOpenedAt: 5 })
    expect(highlights).toMatchObject([{ id: "h1", color: "green", comment: "key idea" }])
    expect(notes[0].content).toMatch(/^# Notes/)
    // The note is the user's words, so it sits beside the paper where Finder shows it, not in .owlit
    expect(readFileSync(path.join(root, "library/papers", id, "note.md"), "utf8")).toBe("# Notes\n\nSee [Vaswani 2017](owlit://library/arxiv-1706.03762).\n")
    expect(existsSync(path.join(root, ".owlit/papers", id, "note.md"))).toBe(false)
    expect(await call("library.removeHighlight", { paperId: id, id: "h1" })).toMatchObject({ id: "h1" })
    expect((await call("library.list")).highlights).toEqual([])
  })

  it("moves a note kept in .owlit (before 2026-10-13) beside its paper when it is next read", async () => {
    const { root, call } = await setup({})
    await call("library.add", { paper: resolvedArxiv })
    const id = "arxiv-1706.03762"
    mkdirSync(path.join(root, ".owlit/papers", id), { recursive: true })
    writeFileSync(path.join(root, ".owlit/papers", id, "note.md"), "Old words.\n")
    const { notes } = await call("library.list")
    expect(notes).toMatchObject([{ paperId: id, content: "Old words.\n" }])
    expect(readFileSync(path.join(root, "library/papers", id, "note.md"), "utf8")).toBe("Old words.\n")
    expect(existsSync(path.join(root, ".owlit/papers", id, "note.md"))).toBe(false)
  })

  it("keeps a title the user corrected when the metadata is fetched again", async () => {
    const { root, call, core } = await setup(published)
    await call("library.add", { paper: { id: "doi-10.1145-3626772.3657891", title: "?", authors: [], ids: { doi: "10.1145/3626772.3657891" } } })
    await call("library.update", { id: "doi-10.1145-3626772.3657891", patch: { title: "My title", year: undefined } })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")
    const paper = await call("library.list").then((l) => l.papers[0])
    expect(paper.title).toBe("My title")
    expect(paper.year).toBeUndefined()
    expect(paper.venue).toMatch(/SIGIR/)
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.json"), "utf8"))
    expect(record.title).toMatch(/^ChroniclingAmericaQA/)
    // Set back to what the record says: no longer an override
    await call("library.update", { id: "doi-10.1145-3626772.3657891", patch: { title: record.title } })
    const state = JSON.parse(readFileSync(path.join(root, ".owlit/papers/doi-10.1145-3626772.3657891/state.json"), "utf8"))
    expect(state.overrides).toEqual({ year: null })
  })

  it("knows a paper by any id it went by: reads, threads and the user's corrections", async () => {
    const { root, call } = await setup({})
    const id = "doi-10.1145-9"
    putPaper(root, { id, title: "Replay ratings", ids: { doi: "10.1145/9", arxiv: "2310.00001" }, year: 2023 })
    writeFileSync(path.join(root, "library/papers", id, "text.md"), "<!-- page 1 -->\nReplay ratings run lower than live ones.\n")
    // Folded into it from a copy a search had found
    mkdirSync(path.join(root, ".owlit/papers"), { recursive: true })
    writeFileSync(path.join(root, ".owlit/papers/aliases.json"), JSON.stringify({ version: 1, aliases: { "s2-abc": id } }))
    expect((await call("library.read", { id: "s2-abc", part: "text" })).text).toContain("Replay ratings run lower")
    // A thread row named by the old id: its full-text answer is checked against the paper's text
    const quote = "Replay ratings run lower than live ones."
    const { id: thread } = await call("threads.write", {
      asked: "Do replay ratings hold?",
      title: "Replay",
      rows: [{ id: "s2-abc", cells: { q: { text: "Lower.", depth: "full", passage: { quote, page: 1 } } } }],
    })
    const row = (await call("threads.get", { id: thread })).rows[0]
    expect(row.cells.q).toMatchObject({ depth: "full", passage: { quote, page: 1 } })
    // The row is the Library's paper, by the Library's id
    expect(row.id).toBe(id)
    // The user's correction is what the thread says the paper is
    await call("library.update", { id, patch: { year: 2024 } })
    expect((await call("threads.get", { id: thread })).rows[0].paper.year).toBe(2024)
  })

  it("takes in the papers of a thread kept by an older version as Owlit's, without seeking their PDFs", async () => {
    const { root, call, core } = await setup({})
    const ws = (core as unknown as { workspace: Workspace }).workspace
    putPaper(root, { id: "doi-10.1145-9", title: "Replay ratings", ids: { doi: "10.1145/9" }, year: 2023 })
    const paper = (doi: string, title: string) => ({ title, authors: ["Oh"], ids: { doi }, year: 2024 })
    const v2 = {
      version: 2,
      id: "old",
      title: "Old",
      asked: { text: "Old?", at: 1 },
      project: "",
      sources: [],
      memo: [{ id: "s1", text: "See [Oh](owlit://library/doi-10.1145-8)." }],
      columns: [{ id: "q", question: "Old?", kind: "ask" }],
      rows: [
        // In the Library under its DOI, named by the arXiv id the search gave
        { id: "arxiv-2310.00009", paper: { ...paper("10.1145/9", "Replay ratings"), ids: { doi: "10.1145/9", arxiv: "2310.00009" } }, cells: {}, addedAt: 1 },
        { id: "doi-10.1145-8", paper: paper("10.1145/8", "Live ratings"), cells: {}, addedAt: 1 },
      ],
      createdAt: 1,
      updatedAt: 1,
      overrides: { edits: {}, removed: {}, placed: {}, merged: {} },
    }
    mkdirSync(path.join(root, ".owlit/threads/old"), { recursive: true })
    writeFileSync(path.join(root, ".owlit/threads/old/thread.json"), JSON.stringify(v2))
    const c = await call("threads.get", { id: "old" })
    expect(c.rows.map((r: { id: string; paper: { title: string } }) => [r.id, r.paper.title])).toEqual([
      ["doi-10.1145-9", "Replay ratings"],
      ["doi-10.1145-8", "Live ratings"],
    ])
    const added = (await call("library.list")).papers.find((p: { id: string }) => p.id === "doi-10.1145-8")
    expect(added.addedBy).not.toMatch(/^p_/)
    const tasks = ws.tasks.list().filter((t) => t.subject === "doi-10.1145-8").map((t) => t.kind)
    expect(tasks).toContain("index.paper")
    expect(tasks).not.toContain("paper.pdf")
    // An add the person asks for still seeks the PDF
    await call("library.add", { paper: { title: "Asked for", authors: [], ids: { doi: "10.1145/7" } } })
    expect(ws.tasks.list().filter((t) => t.subject === "doi-10.1145-7").map((t) => t.kind)).toContain("paper.pdf")
  })

  it("moves a removed paper to the trash and Undo brings it back whole", async () => {
    const { root, call } = await setup({})
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: resolvedArxiv })
    await call("library.setNote", { paperId: id, content: "kept" })
    await call("library.putHighlight", { highlight: { id: "h", paperId: id, page: 0, rects: [], text: "t", color: "blue", createdAt: 1 } })
    await call("library.remove", { ids: [id] })
    expect(existsSync(path.join(root, "library/papers", id))).toBe(false)
    expect((await call("library.list")).papers).toEqual([])
    expect(await call("library.known", { inputs: ["1706.03762"] })).toEqual([null])
    const [back] = await call("library.restore", { ids: [id] })
    expect(back.id).toBe(id)
    const { highlights, notes } = await call("library.list")
    expect(highlights).toHaveLength(1)
    expect(notes[0].content).toBe("kept")
    expect(await call("library.known", { inputs: ["1706.03762"] })).toEqual([id])
  })

  it("removing a paper that is already in the trash leaves the trash as it was, so Undo still brings it back", async () => {
    const { root, call } = await setup({})
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: resolvedArxiv })
    await call("library.remove", { ids: [id] })
    await call("library.remove", { ids: [id] })
    expect(readdirSync(path.join(root, ".owlit/trash"))).toHaveLength(1)
    const [back] = await call("library.restore", { ids: [id] })
    expect(back?.id).toBe(id)
  })

  it("Undo brings a paper back even when a step wrote into its folder after it was removed", async () => {
    const { root, call } = await setup({})
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: resolvedArxiv })
    await call("library.setNote", { paperId: id, content: "kept" })
    await call("library.remove", { ids: [id] })
    // A download that finished after the removal, before it heard it was cancelled
    mkdirSync(path.join(root, "library/papers", id), { recursive: true })
    writeFileSync(path.join(root, "library/papers", id, "late.txt"), "late")
    mkdirSync(path.join(root, ".owlit/papers", id), { recursive: true })
    const [back] = await call("library.restore", { ids: [id] })
    expect(back?.id).toBe(id)
    expect(readFileSync(path.join(root, "library/papers", id, "note.md"), "utf8")).toContain("kept")
    expect(existsSync(path.join(root, "library/papers", id, "late.txt"))).toBe(true)
    expect(existsSync(path.join(root, ".owlit/papers", id, "state.json"))).toBe(true)
    expect(readdirSync(path.join(root, ".owlit/trash"))).toEqual([])
  })

  it("restoring a paper that is in the library already gives it back as it is and leaves the trash alone", async () => {
    const { root, call } = await setup({})
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: resolvedArxiv })
    await call("library.remove", { ids: [id] })
    await call("library.add", { paper: resolvedArxiv })
    await call("library.update", { id, patch: { starred: true } })
    const [back] = await call("library.restore", { ids: [id] })
    expect(back).toMatchObject({ id, starred: true })
    expect(readdirSync(path.join(root, ".owlit/trash"))).toHaveLength(1)
    expect(await call("library.restore", { ids: [id] })).toHaveLength(1)
  })

  it("lists the papers removed in the last 30 days, newest first, until they are back", async () => {
    const { root, call } = await setup({})
    await call("library.add", { paper: resolvedArxiv })
    await call("library.update", { id: resolvedArxiv.id, patch: { title: "Attention (my title)" } })
    await call("library.add", { paper: { id: "arxiv-2408.00447", title: "Second", authors: [], ids: { arxiv: "2408.00447" } } })
    await call("library.add", { paper: { id: "arxiv-2403.17859", title: "Old", authors: [], ids: { arxiv: "2403.17859" } } })
    await call("library.remove", { ids: ["arxiv-2403.17859"] })
    await call("library.remove", { ids: [resolvedArxiv.id] })
    await call("library.remove", { ids: ["arxiv-2408.00447"] })
    const trash = path.join(root, ".owlit/trash")
    // Removed a second before the next, as two removals in the same millisecond would have no order
    const first = readdirSync(trash).find((name) => name.endsWith(`-paper-${resolvedArxiv.id}`))!
    renameSync(path.join(trash, first), path.join(trash, `${Number.parseInt(first, 10) - 1000}-paper-${resolvedArxiv.id}`))
    // Removed long ago: kept in the trash, no longer offered
    const old = readdirSync(trash).find((name) => name.endsWith("-paper-arxiv-2403.17859"))!
    renameSync(path.join(trash, old), path.join(trash, `${Date.now() - 31 * 86_400_000}-paper-arxiv-2403.17859`))
    const listed = await call("library.trash")
    expect(listed.map((p: { id: string }) => p.id)).toEqual(["arxiv-2408.00447", resolvedArxiv.id])
    expect(listed[1]).toMatchObject({ title: "Attention (my title)", authors: ["Ashish Vaswani"], year: 2017 })
    expect(listed[1].removedAt).toBeLessThan(listed[0].removedAt)
    await call("library.restore", { ids: [resolvedArxiv.id] })
    expect((await call("library.trash")).map((p: { id: string }) => p.id)).toEqual(["arxiv-2408.00447"])
  })

  it("hears about a paper folder another program puts in library/papers", async () => {
    const { root, core } = await setup({})
    const heard: any[] = []
    core.onNotify((n) => n.method === "library.changed" && heard.push(n.params))
    // A watcher only just started can miss a write (FSEvents on macOS): the program writes again until core
    // hears it, spaced beyond the library's 300 ms settle, which each write would push back
    const isHeard = () => heard.some((c) => c.papers.some((p: { id: string }) => p.id === "arxiv-2408.00447"))
    await vi.waitFor(
      () => {
        if (!isHeard()) putPaper(root, { id: "arxiv-2408.00447", title: "Dropped in by the CLI", ids: { arxiv: "2408.00447" } })
        expect(isHeard()).toBe(true)
      },
      { timeout: 4_000, interval: 1_000 },
    )
    const paper = heard.flatMap((c) => c.papers).find((p) => p.id === "arxiv-2408.00447")
    // Nobody owlit knows added it
    expect(paper).toMatchObject({ title: "Dropped in by the CLI", status: "unread", addedBy: "other" })
  })
})

describe("a paper's digest when it moves or goes", () => {
  // A digest written the moment the paper is moved to a DOI or removed: the write waits for the library's
  // lock behind the change, or goes first and moves with it. A write that went first into a folder
  // already gone would bring the old id's folder back with only digest.md in it.
  async function digestWhile(change: (library: Workspace["library"], id: string) => Promise<unknown>) {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-library-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    const library = { http: new Http({ fetch: (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch, userAgent: "owlit" }), settings: async () => ({}) }
    const workspace: Workspace = await Workspace.open(root, path.join(base, "userData"), { library, tasks: { definitions: (ws) => ws.search.tasks() } })
    cores.push(workspace)
    const id = "local-0123456789ab"
    await workspace.library.addNew({ id, title: "A paper", authors: [], ids: {} })
    writeFileSync(path.join(root, "library/papers", id, "text.md"), "<!-- page 1 -->\n\nThe paper's text.\n")
    const changing = change(workspace.library, id)
    await workspace.library.putDigest(id, "# A paper\n\n## Summary\n\nWords.\n", null).catch(() => undefined)
    await changing
    return { root, id }
  }

  it("leaves no folder for the old id when a digest is written as the paper moves to a DOI", async () => {
    const { root, id } = await digestWhile((library, id) => library.update(id, { ids: { doi: "10.1145/3626772.3657891" } }))
    expect(existsSync(path.join(root, "library/papers", id))).toBe(false)
    expect(existsSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891"))).toBe(true)
  })

  it("leaves no folder behind when a digest is written as the paper is removed", async () => {
    const { root, id } = await digestWhile((library, id) => library.remove([id]))
    expect(existsSync(path.join(root, "library/papers", id))).toBe(false)
  })
})
