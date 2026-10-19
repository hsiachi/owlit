import { ROLE_TABLE, type DocComment, type Role, type Touches } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { knownProfile, ME, MY_OWLIT } from "../test-util.ts"
import { commentTouches, decide, type Who } from "./policy.ts"

const CLASSES: Touches[] = ["read", "own", "meta", "words", "structure", "admin"]
const ROLE_IDS: Role[] = ["reviewer", "assistant", "coauthor"]

const inChat = (role: Role): Who => ({ caller: { kind: "socket", chatId: "c1" }, actor: MY_OWLIT, role })
const inRun: Who = { caller: { kind: "socket", run: "threads.more:t1" }, actor: MY_OWLIT }
const command: Who = { caller: { kind: "socket" }, actor: "other" }
const window: Who = { caller: { kind: "window" }, actor: ME }

const refused = (decision: ReturnType<typeof decide>) => typeof decision === "object"

describe("decide", () => {
  it("answers a chat's agent from the role table, class by class", () => {
    for (const touches of CLASSES) {
      for (const role of ROLE_IDS) {
        const decision = decide(inChat(role), touches, {})
        const expected = ROLE_TABLE[touches][role]
        if (expected === "refuse") expect(decision, `${touches} as ${role}`).toHaveProperty("refuse")
        else expect(decision, `${touches} as ${role}`).toBe("allow")
      }
    }
    expect(decide(inChat("reviewer"), "meta", {})).toEqual({ refuse: expect.stringMatching(/^Owlit works as Reviewer in this chat and changes nothing of the user's/) })
    expect(decide(inChat("coauthor"), "admin", {})).toEqual({ refuse: expect.stringMatching(/the user's alone/) })
  })

  it("never polices the person at the window", () => {
    for (const touches of CLASSES) expect(decide(window, touches, { by: MY_OWLIT })).toBe("allow")
  })

  it("lets a caller with nobody to ask read and change only Owlit's own things", () => {
    for (const who of [inRun, command]) {
      expect(decide(who, "read", {})).toBe("allow")
      expect(decide(who, "own", {})).toBe("allow")
      for (const touches of ["meta", "words", "structure", "admin"] as const) expect(refused(decide(who, touches, {})), `${touches} for ${who.caller.kind}`).toBe(true)
    }
    expect(decide(inRun, "meta", {})).toEqual({ refuse: expect.stringMatching(/^Owlit works on its own here/) })
    expect(decide(command, "words", {})).toEqual({ refuse: "owlit's command can't change the user's workspace; use the app." })
  })

  it("decides own on the target: Owlit's while Owlit made it and nobody else touched it since", () => {
    const owlit = inChat("reviewer")
    // A thing not there yet is the caller's to make
    expect(decide(owlit, "own", { what: "comment" })).toBe("allow")
    expect(decide(owlit, "own", { what: "comment", by: MY_OWLIT })).toBe("allow")
    expect(decide(owlit, "own", { what: "comment", by: ME })).toEqual({ refuse: "That comment is the user's, not Owlit's to change; name it in your answer and let them decide." })
    // A paper Owlit added and the person then starred
    expect(decide(owlit, "own", { what: "paper", by: MY_OWLIT, touchedBy: [ME] })).toEqual({ refuse: expect.stringMatching(/^The user has changed that paper since, so it is theirs now/) })
    // Owlit's own later touches don't make it anyone else's
    expect(decide(owlit, "own", { what: "paper", by: MY_OWLIT, touchedBy: [MY_OWLIT] })).toBe("allow")
    // Another person's Owlit is another actor
    expect(refused(decide(owlit, "own", { by: "o_ffffffff" }))).toBe(true)
  })
})

describe("commentTouches", () => {
  const owlit = inChat("assistant")
  const anchor = { quote: "the words", prefix: "", suffix: "" }
  const mine: DocComment = { id: "m", ...anchor, entries: [{ id: "m1", by: MY_OWLIT, text: "Cite it.", at: 1 }], createdAt: 1 }
  const theirs: DocComment = { id: "t", ...anchor, entries: [{ id: "t1", by: ME, text: "Is this right?", at: 1 }], createdAt: 1 }
  const target = (was: DocComment) => ({ what: "comment", by: was.entries[0]!.by, was })

  it("is own for a new comment, and for anything under Owlit's own", () => {
    expect(commentTouches(mine, { what: "comment" }, owlit)).toBe("own")
    expect(commentTouches({ ...mine, entries: [...mine.entries, { id: "m2", text: "More.", at: 2 }] }, target(mine), owlit)).toBe("own")
    expect(commentTouches({ ...mine, resolvedAt: 3 }, target(mine), owlit)).toBe("own")
    expect(commentTouches({ ...mine, entries: [{ ...mine.entries[0]!, text: "Cite it, p. 4." }] }, target(mine), owlit)).toBe("own")
  })

  it("is meta to reply under a person's comment or resolve it, and words to touch their entries", () => {
    expect(commentTouches({ ...theirs, entries: [...theirs.entries, { id: "r", text: "Yes.", at: 2 }] }, target(theirs), owlit)).toBe("meta")
    expect(commentTouches({ ...theirs, resolvedAt: 3, entries: [...theirs.entries, { id: "r", text: "Done.", at: 2 }] }, target(theirs), owlit)).toBe("meta")
    expect(commentTouches({ ...theirs, entries: [{ ...theirs.entries[0]!, text: "changed" }] }, target(theirs), owlit)).toBe("words")
    expect(commentTouches({ ...theirs, entries: [] }, target(theirs), owlit)).toBe("words")
    expect(commentTouches({ ...theirs, quote: "other words" }, target(theirs), owlit)).toBe("words")
  })

  it("lets Owlit edit its own reply under a person's comment, and the person's reply under its own is theirs", () => {
    const replied: DocComment = { ...theirs, entries: [...theirs.entries, { id: "r", by: MY_OWLIT, text: "Yes.", at: 2 }] }
    expect(commentTouches({ ...replied, entries: [theirs.entries[0]!, { ...replied.entries[1]!, text: "Yes, p. 2." }] }, target(replied), owlit)).toBe("own")
    const answered: DocComment = { ...mine, entries: [...mine.entries, { id: "p", by: ME, text: "Where?", at: 2 }] }
    expect(commentTouches({ ...answered, entries: [mine.entries[0]!] }, target(answered), owlit)).toBe("words")
    // Replying again under its own comment after the person did is still Owlit's own
    expect(commentTouches({ ...answered, entries: [...answered.entries, { id: "m3", text: "On p. 2.", at: 3 }] }, target(answered), owlit)).toBe("own")
  })
})

// ---- Through the router ----

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-policy-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "notes.md"), "The first claim.\n")
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")) })
  cores.push(core)
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false, role: "reviewer" } })
  const paper = (id: string) => ({ id, title: `Paper ${id}`, authors: [], ids: { doi: `10.9/${id}` } })
  return { call, paper, mcp: { kind: "socket", chatId: "c1" } as Caller }
}

describe("the router's policy", () => {
  it("refuses a meta call from a Reviewer's chat before the handler runs, and lets the window through", async () => {
    const { call, paper, mcp } = await setup()
    await call("library.add", { paper: paper("doi-10.9-a") })
    await expect(call("library.update", { id: "doi-10.9-a", patch: { starred: true } }, mcp)).rejects.toMatchObject({ code: -32005, message: expect.stringMatching(/^Not done: Owlit works as Reviewer/) })
    expect((await call("library.list")).papers[0].starred).toBe(false)
    expect((await call("library.update", { id: "doi-10.9-a", patch: { starred: true } })).starred).toBe(true)
    // As Assistant the marks are Owlit's to change, recorded as its
    await call("chats.update", { id: "c1", patch: { role: "assistant" } })
    expect((await call("library.update", { id: "doi-10.9-a", patch: { tags: ["baseline"] } }, mcp)).tags).toEqual(["baseline"])
    expect((await call("changes.list", { path: "doi-10.9-a" }))[0]).toMatchObject({ actor: MY_OWLIT, target: { part: "tags" }, origin: { chatId: "c1" } })
    // Its details are the person's words: as Assistant the change lands as a proposal, recorded with Undo
    expect((await call("library.update", { id: "doi-10.9-a", patch: { title: "Other" } }, mcp)).title).toBe("Other")
    const proposed = (await call("changes.list", { path: "doi-10.9-a" }))[0]
    expect(proposed).toMatchObject({ actor: MY_OWLIT, target: { part: "overrides.title" } })
    await call("changes.undo", { id: proposed.id })
    expect((await call("library.list")).papers[0].title).toBe("Paper doi-10.9-a")
  })

  it("decides own on what the log and the records say is Owlit's", async () => {
    const { call, paper, mcp } = await setup()
    const comment = { id: "n1", quote: "The first claim.", prefix: "", suffix: "", entries: [{ id: "e1", text: "Is this right?", at: 1 }], createdAt: 1 }
    await call("comments.add", { path: "notes.md", comment })
    // A Reviewer may not remove the person's comment, nor undo their change, but may take back its own
    await expect(call("comments.remove", { path: "notes.md", id: "n1" }, mcp)).rejects.toThrow(/^Not done: That comment is the user's/)
    await call("comments.add", { path: "notes.md", comment: { ...comment, id: "n2", entries: [{ id: "e2", text: "Cite it.", at: 2 }] } }, mcp)
    const [made] = await call("changes.list", { target: { kind: "comment", path: "notes.md", part: "n2" } })
    expect(made.actor).toBe(MY_OWLIT)
    const [theirs] = await call("changes.list", { target: { kind: "comment", path: "notes.md", part: "n1" } })
    await expect(call("changes.undo", { id: theirs.id }, mcp)).rejects.toThrow(/^Not done: That change is the user's/)
    await call("changes.undo", { id: made.id }, mcp)
    expect((await call("comments.all"))["notes.md"].map((c: { id: string }) => c.id)).toEqual(["n1"])
    // A paper Owlit added is its own, in any role, until the person touches it
    await call("library.add", { paper: paper("doi-10.9-b") }, mcp)
    await call("library.add", { paper: paper("doi-10.9-c") }, mcp)
    expect((await call("library.list")).papers.map((p: { addedBy: string }) => p.addedBy)).toEqual([MY_OWLIT, MY_OWLIT])
    await call("library.update", { id: "doi-10.9-c", patch: { starred: true } })
    await expect(call("library.removeByAgent", { ids: ["doi-10.9-c"] }, mcp)).rejects.toThrow(/^Not done: The user has changed that paper since/)
    expect(await call("library.removeByAgent", { ids: ["doi-10.9-b"] }, mcp)).toEqual({ removed: ["doi-10.9-b"], refused: [] })
  })

  it("refuses a program with no chat everything but reads and Owlit's own things", async () => {
    const { call, paper } = await setup()
    const command: Caller = { kind: "socket" }
    // owlit add: the paper is the command's own, as other
    expect((await call("library.add", { paper: paper("doi-10.9-a") }, command)).addedBy).toBe("other")
    await expect(call("library.update", { id: "doi-10.9-a", patch: { starred: true } }, command)).rejects.toThrow("Not done: owlit's command can't change the user's workspace; use the app.")
    await expect(call("settings.update", { patch: {} }, command)).rejects.toThrow(/the user's alone/)
    expect((await call("library.list", undefined, command)).papers).toHaveLength(1)
    await call("memory.write", { op: "add", kind: "about", text: "Works on replay studies." }, command)
    expect((await call("memory.list")).lines).toMatchObject([{ text: "Works on replay studies." }])
  })

  it("treats a caller naming a chat that isn't there as a program with no chat", async () => {
    const { call, paper } = await setup()
    const borrowed: Caller = { kind: "socket", chatId: "nobody's" }
    await call("library.add", { paper: paper("doi-10.9-a") })
    await expect(call("library.update", { id: "doi-10.9-a", patch: { starred: true } }, borrowed)).rejects.toThrow("Not done: owlit's command can't change the user's workspace; use the app.")
    await expect(call("agents.deleteDocs", { paths: ["notes.md"] }, borrowed)).rejects.toThrow(/^Not done: owlit's command/)
    expect((await call("library.list", undefined, borrowed)).papers).toHaveLength(1)
    await call("library.add", { paper: paper("doi-10.9-b") }, borrowed)
    expect((await call("library.list")).papers).toHaveLength(2)
  })
})
