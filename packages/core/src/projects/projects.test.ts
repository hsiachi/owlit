import { docUri, paperUri, threadUri, type Change, type Chat, type ChatMessage, type Project, type RpcNotification } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { Http } from "../net/http.ts"
import type { Caller } from "../rpc/index.ts"
import { eventually, knownProfile } from "../test-util.ts"
import { Workspace } from "../workspace/workspace.ts"
import { parseMark, Projects, type ProjectsServices } from "./projects.ts"

// A workspace as Projects sees it: paths with their text (marks) and mtime
type Files = Record<string, { text?: string; at?: number }>

function projectsOver(files: Files, services: Partial<ProjectsServices> = {}) {
  return new Projects({
    files: async () => Object.entries(files).map(([p, f]) => ({ path: p, modifiedAt: f.at ?? 0 })),
    read: async (rel) => files[rel]?.text ?? null,
    chat: async () => null,
    changesOf: async () => [],
    thread: async () => undefined,
    docsLinking: async () => [],
    canonical: async () => undefined,
    ...services,
  })
}

const paths = (projects: (Project | null)[]) => projects.map((p) => p?.path ?? null)

describe("projects", () => {
  it("makes a marked folder a project at any depth, under folders that are none", async () => {
    const projects = projectsOver({
      "2026/Proactive/project.md": { text: "# Proactive Support\n" },
      "2026/Proactive/draft.md": {},
      "2026/loose.md": {},
      "notes.md": {},
    })
    expect(await projects.list()).toEqual([expect.objectContaining({ path: "2026/Proactive", mark: "2026/Proactive/project.md", name: "Proactive Support", parents: [] })])
    expect((await projects.projectOf("2026/Proactive/draft.md"))?.path).toBe("2026/Proactive")
    expect((await projects.projectOf("2026/Proactive"))?.path).toBe("2026/Proactive")
    expect(await projects.projectOf("2026/loose.md")).toBeNull()
    expect(await projects.projectOf("notes.md")).toBeNull()
    expect(await projects.projectOf("2026")).toBeNull()
  })

  it("puts a thing in the nearest of nested projects, with the ones above as its lineage", async () => {
    const projects = projectsOver({
      "A/project.md": {},
      "A/B/Project.md": {},
      "A/B/C/D/project.md": {},
      "A/x.md": {},
      "A/B/y.md": {},
      "A/B/C/z.md": {},
    })
    expect((await projects.list()).map((p) => [p.path, p.parents])).toEqual([
      ["A", []],
      ["A/B", ["A"]],
      ["A/B/C/D", ["A/B", "A"]],
    ])
    expect(paths(await Promise.all(["A/x.md", "A/B/y.md", "A/B/C/z.md", "A/B/C/D/w.md"].map((p) => projects.projectOf(p))))).toEqual(["A", "A/B", "A/B", "A/B/C/D"])
  })

  it("ignores a project.md at the workspace's root: a root doc is in no project", async () => {
    const projects = projectsOver({ "project.md": { text: "# Everything" }, "notes.md": {} })
    expect(await projects.list()).toEqual([])
    expect(await projects.projectOf("notes.md")).toBeNull()
  })

  it("follows a mark that moves, and forgets one that goes", async () => {
    const files: Files = { "Old/project.md": { text: "# Story" }, "Old/a.md": {} }
    const projects = projectsOver(files)
    expect(paths(await projects.list())).toEqual(["Old"])
    delete files["Old/project.md"]
    delete files["Old/a.md"]
    files["New/project.md"] = { text: "# Story" }
    files["New/a.md"] = {}
    expect((await projects.list()).map((p) => [p.path, p.name])).toEqual([["New", "Story"]])
    expect(await projects.projectOf("Old/a.md")).toBeNull()
    delete files["New/project.md"]
    expect(await projects.list()).toEqual([])
    expect(await projects.projectOf("New/a.md")).toBeNull()
  })

  it("reads a mark again only once it changed", async () => {
    const files: Files = { "P/project.md": { text: "# One", at: 1 } }
    const read = vi.fn(async (rel: string) => files[rel]?.text ?? null)
    const projects = projectsOver(files, { read })
    expect((await projects.list())[0].name).toBe("One")
    expect((await projects.list())[0].name).toBe("One")
    expect(read).toHaveBeenCalledTimes(1)
    files["P/project.md"] = { text: "# Two", at: 2 }
    expect((await projects.list())[0].name).toBe("Two")
  })

  it("tells a change after the first look, and only a change", async () => {
    const files: Files = { "P/project.md": { text: "# P", at: 1 } }
    const changed = vi.fn()
    const projects = projectsOver(files, { changed })
    await projects.refresh()
    await projects.refresh()
    expect(changed).not.toHaveBeenCalled()
    files["P/project.md"] = { text: "# P\nstatus: done", at: 2 }
    await projects.refresh()
    expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({ path: "P", status: "done" })])
    files["Q/project.md"] = { at: 3 }
    await projects.refresh()
    expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({ path: "P" }), expect.objectContaining({ path: "Q", name: "Q" })])
    expect(changed).toHaveBeenCalledTimes(2)
  })
})

describe("parseMark", () => {
  it("reads the name and the lines at the top", () => {
    expect(parseMark("# Proactive Support\nstatus: Active\ndue: 2026-11-15\n\nWhat this is about.\n")).toEqual({ name: "Proactive Support", status: "active", due: "2026-11-15" })
  })

  it("stops at the first line of prose, so the notes below change nothing", () => {
    expect(parseMark("# P\n\nWe said status: done would be nice.\nstatus: done\n")).toEqual({ name: "P" })
    expect(parseMark("Just notes.\n# Later heading\n")).toEqual({})
  })

  it("takes the lines from front matter too, and leaves out values it can't read", () => {
    expect(parseMark("---\ntitle: x\nstatus: done\n---\n# P\ndue: soon\nstatus: paused\n")).toEqual({ name: "P", status: "done" })
  })
})

describe("a project's newest doc", () => {
  it("is its newest Markdown doc by mtime, the mark and nested projects' docs left out", async () => {
    const projects = projectsOver({
      "P/project.md": { at: 99 },
      "P/研究故事-v2-Dataset.md": { at: 1 },
      "P/archive/研究故事-v4.md": { at: 9 },
      "P/Plan.md": { at: 3 },
      "P/figure.png": { at: 20 },
      "P/Sub/project.md": { at: 1 },
      "P/Sub/Plan v2.md": { at: 10 },
      "Q/project.md": { at: 5 },
    })
    const [p, sub, q] = await projects.list()
    // A doc filed in an Archive folder is still the project's
    expect(p.lastDoc).toEqual({ path: "P/archive/研究故事-v4.md", modifiedAt: 9 })
    expect(sub.lastDoc).toEqual({ path: "P/Sub/Plan v2.md", modifiedAt: 10 })
    expect(q).not.toHaveProperty("lastDoc")
  })

  it("goes by path between two docs of the same mtime, whatever order the files come in", async () => {
    const projects = projectsOver({ "P/project.md": {}, "P/b.md": { at: 4 }, "P/a.md": { at: 4 } })
    expect((await projects.list())[0].lastDoc).toEqual({ path: "P/a.md", modifiedAt: 4 })
  })
})

const message = (fields: Partial<ChatMessage>): ChatMessage => ({ id: `m${Math.random()}`, role: "user", parts: [], createdAt: 0, ...fields })
const chatOf = (id: string, messages: ChatMessage[], about?: Chat["about"]): Chat => ({ id, title: "", createdAt: 0, updatedAt: 0, pinned: false, messages, ...(about ? { about } : {}) })
const docMention = (rel: string) => ({ id: rel, kind: "doc" as const, title: rel, uri: docUri(rel) })
const threadMention = (id: string) => ({ id, kind: "thread" as const, title: id, uri: threadUri(id) })
const changeOf = (kind: Change["target"]["kind"], target: string): Change => ({ id: target, at: 0, actor: "other", action: "update", target: { kind, path: target }, origin: { via: "tool", chatId: "c" } })

describe("projectsOf", () => {
  const files: Files = { "A/project.md": {}, "A/B/project.md": {}, "C/project.md": {}, "D/project.md": {}, "E/project.md": {}, "F/project.md": {}, "loose.md": {} }

  it("puts a chat in the projects of the docs and threads it touched", async () => {
    const chat = chatOf("c", [
      message({ mentions: [docMention("A/B/x.md"), docMention("loose.md")], context: [docMention("A/y.md")] }),
      message({ role: "assistant", mentions: [threadMention("t-marked")] }),
      message({ selection: { text: "quote", source: docMention("A/B/x.md") }, mentions: [threadMention("t-unmarked")] }),
    ])
    const projects = projectsOver(files, {
      chat: async (id) => (id === "c" ? chat : null),
      changesOf: async (id) => (id === "c" ? [changeOf("doc", "C/written.md"), changeOf("comment", "D/commented.md"), changeOf("paper", "E/not-a-doc"), changeOf("thread", "t-written")] : []),
      thread: async (id) => ({ "t-marked": { project: "F" }, "t-unmarked": { project: "Somewhere" }, "t-written": { project: "" } })[id],
      docsLinking: async (uri) => (uri === threadUri("t-written") ? ["E/cites-thread.md"] : []),
    })
    expect(paths(await projects.projectsOf({ kind: "chat", id: "c" }))).toEqual(["A/B", "A", "C", "D", "F", "E"])
    expect(await projects.projectsOf({ kind: "chat", id: "gone" })).toEqual([])
  })

  it("puts a chat in the project the person put it in first, while that folder is marked", async () => {
    const chats: Record<string, Chat> = {
      put: { ...chatOf("put", [message({ context: [docMention("A/y.md")] })]), project: "/C/" },
      unmarked: { ...chatOf("unmarked", [message({ context: [docMention("A/y.md")] })]), project: "Somewhere" },
    }
    const projects = projectsOver(files, { chat: async (id) => chats[id] ?? null })
    expect(paths(await projects.projectsOf({ kind: "chat", id: "put" }))).toEqual(["C", "A"])
    expect(paths(await projects.projectsOf({ kind: "chat", id: "unmarked" }))).toEqual(["A"])
  })

  it("puts a chat owlit started in the project of what it is about", async () => {
    const chats: Record<string, Chat> = {
      doc: chatOf("doc", [], { kind: "doc", id: "C/a.md" }),
      comment: chatOf("comment", [], { kind: "comment", id: "D/b.md#c1" }),
      thread: chatOf("thread", [], { kind: "thread", id: "t" }),
    }
    const projects = projectsOver(files, { chat: async (id) => chats[id] ?? null, thread: async () => ({ project: "/E/" }) })
    expect(paths(await projects.projectsOf({ kind: "chat", id: "doc" }))).toEqual(["C"])
    expect(paths(await projects.projectsOf({ kind: "chat", id: "comment" }))).toEqual(["D"])
    expect(paths(await projects.projectsOf({ kind: "chat", id: "thread" }))).toEqual(["E"])
  })

  it("puts a thread in the marked folder it names and the projects of the docs linking it", async () => {
    const projects = projectsOver(files, {
      thread: async (id) => (id === "t" ? { project: "A/B" } : id === "old" ? { project: "A/B/x" } : undefined),
      docsLinking: async (uri) => (uri === threadUri("t") || uri === threadUri("old") ? ["C/report.md", "loose.md", "A/B/also.md"] : []),
    })
    expect(paths(await projects.projectsOf({ kind: "thread", id: "t" }))).toEqual(["A/B", "C"])
    expect(paths(await projects.projectsOf({ kind: "thread", id: "old" }))).toEqual(["C", "A/B"])
    expect(await projects.projectsOf({ kind: "thread", id: "none" })).toEqual([])
  })

  it("puts a paper in the projects of the docs citing it, by its Library id", async () => {
    const docsLinking = vi.fn(async (uri: string) => (uri === paperUri("p-lib") ? ["D/cites.md", "D/also.md", "A/cites.md"] : []))
    const projects = projectsOver(files, { canonical: async (id) => (id === "doi-alias" ? "p-lib" : undefined), docsLinking })
    expect(paths(await projects.projectsOf({ kind: "paper", id: "doi-alias" }))).toEqual(["D", "A"])
    expect(docsLinking).toHaveBeenCalledWith(paperUri("p-lib"))
  })

  it("puts a memory line in its chat's projects", async () => {
    const projects = projectsOver(files, { chat: async (id) => (id === "c" ? chatOf("c", [message({ context: [docMention("C/a.md")] })]) : null) })
    expect(paths(await projects.projectsOf({ kind: "memory", line: { chatId: "c" } }))).toEqual(["C"])
    expect(await projects.projectsOf({ kind: "memory", line: { chatId: "gone" } })).toEqual([])
    expect(await projects.projectsOf({ kind: "memory", line: {} })).toEqual([])
  })

  it("puts a doc in its project", async () => {
    const projects = projectsOver(files)
    expect(paths(await projects.projectsOf({ kind: "doc", path: "A/B/c/d.md" }))).toEqual(["A/B"])
    expect(await projects.projectsOf({ kind: "doc", path: "loose.md" })).toEqual([])
  })
})

// ---- Against a real workspace

const opened: { dispose: () => Promise<unknown> }[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((o) => o.dispose()))
})

function folderWith(files: Record<string, string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-projects-")))
  const root = path.join(base, "ws")
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  mkdirSync(root, { recursive: true })
  return { base, root, at: (rel: string) => path.join(root, rel) }
}

describe("projects in a workspace", () => {
  it("finds a chat's docs in its messages and in what its turns wrote", async () => {
    const { base, root } = folderWith({ "Talk/project.md": "# Talk", "Paper/project.md": "# Paper", "Paper/draft.md": "x" })
    const library = { http: new Http({ fetch: (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch, userAgent: "owlit" }), settings: async () => ({}) }
    const ws = await Workspace.open(root, path.join(base, "userData"), { library, tasks: { definitions: (w) => w.search.tasks(), start: false }, profile: async () => ({ id: "1234abcd" }) })
    opened.push(ws)
    await ws.chats.create({ id: "c1", title: "", createdAt: 0, updatedAt: 0, pinned: false })
    await ws.chats.appendMessage("c1", message({ context: [docMention("Paper/draft.md")] }))
    await ws.recorder.doc({ kind: "socket", chatId: "c1" }, "Talk/slides.md", null, "# Slides")
    expect(paths(await ws.projects.projectsOf({ kind: "chat", id: "c1" }))).toEqual(["Paper", "Talk"])
    expect((await ws.projects.list()).map((p) => [p.path, p.name, p.lastDoc?.path])).toEqual([
      ["Paper", "Paper", "Paper/draft.md"],
      ["Talk", "Talk", undefined],
    ])
  })

  it("puts a chat in the project of a doc its agent wrote with docs_write, with nothing else linking them", async () => {
    const { base, root } = folderWith({ "Talk/project.md": "# Talk", "Talk/Meetings/Weekly · reading.md": "# Earlier" })
    const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")) })
    opened.push(core)
    const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
    expect((await call("projects.ofChat", { chatId: "c1" })).projects).toEqual([])
    // As owlit-mcp's docs_write asks for the chat's agent
    await call("agents.writeDoc", { path: "Talk/Meetings/Weekly 2 · reading.md", content: "# Reading\n" }, { kind: "socket", chatId: "c1" })
    expect((await call("projects.ofChat", { chatId: "c1" })).projects.map((p: Project) => p.path)).toEqual(["Talk"])
    expect((await call("chats.get", { id: "c1" })).messages).toEqual([])
  })

  it("tells projects.changed when a mark is moved, edited, made or deleted, in the app or outside it", async () => {
    const { base, root, at } = folderWith({ "2026/Story/project.md": "# Story\n", "2026/Story/story-v1.md": "one", "loose.md": "x" })
    const core = new Core({ userDataDir: path.join(base, "userData") })
    opened.push(core)
    const told: Project[][] = []
    let docsHeard = false
    core.onNotify((n: RpcNotification) => {
      if (n.method === "projects.changed") told.push((n.params as { projects: Project[] }).projects)
      if (n.method === "docs.changed") docsHeard = true
    })
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    const listed = async () => ((await call("projects.list")).projects as Project[]).map((p) => [p.path, p.name])
    const last = () => told.at(-1)?.map((p) => [p.path, p.name])
    expect(await listed()).toEqual([["2026/Story", "Story"]])

    await call("docs.rename", { path: "2026/Story", name: "Tale" })
    await eventually(() => expect(last()).toEqual([["2026/Tale", "Story"]]))
    const mark = await call("docs.read", { path: "2026/Tale/project.md" })
    await call("docs.write", { path: "2026/Tale/project.md", content: "# A Tale\n", expectedModifiedAt: mark.modifiedAt })
    await eventually(() => expect(last()).toEqual([["2026/Tale", "A Tale"]]))
    await call("docs.create", { path: "Other/project.md", content: "" })
    await eventually(() => expect(last()).toEqual([["2026/Tale", "A Tale"], ["Other", "Other"]]))
    await call("docs.delete", { path: "Other/project.md" })
    await eventually(() => expect(last()).toEqual([["2026/Tale", "A Tale"]]))

    // A watcher only just started can miss a write: written again until heard
    await vi.waitFor(
      () => {
        if (!docsHeard) writeFileSync(at("probe.md"), "probe")
        expect(docsHeard).toBe(true)
      },
      { timeout: 4_000, interval: 500 },
    )
    mkdirSync(at("Outside"))
    writeFileSync(at("Outside/project.md"), "# Made outside\n")
    await eventually(() => expect(last()).toEqual([["2026/Tale", "A Tale"], ["Outside", "Made outside"]]))
    rmSync(at("2026/Tale/project.md"))
    await eventually(() => expect(last()).toEqual([["Outside", "Made outside"]]))
    expect(await listed()).toEqual([["Outside", "Made outside"]])
  })
})
