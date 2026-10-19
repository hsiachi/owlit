import type { Change } from "@owlit/protocol"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { sha1 } from "../fs-util.ts"
import { changeId, ChangeLog, KEEP_MS, KEEP_PER_PATH } from "./log.ts"
import { Recorder } from "./record.ts"

const entry = (target: Change["target"], extra: Partial<Change> = {}): Change => {
  const at = extra.at ?? Date.now()
  return { id: changeId(at, target.path), at, actor: "o_1234abcd", action: "update", target, origin: { via: "tool" }, ...extra }
}

describe("ChangeLog", () => {
  it("keeps a doc's text from before beside its entry, and nothing for inline targets", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-changes-"))
    const log = new ChangeLog(owlit)
    const doc = await log.append(entry({ kind: "doc", path: "notes/a.md" }, { afterHash: sha1("after") }), "before")
    const memory = await log.append(entry({ kind: "memory", path: "memory", part: "m1" }, { action: "create", after: { id: "m1", kind: "work", text: "cite as (Author, Year)", at: 1 } }))
    expect(await log.content(doc.id)).toBe("before")
    expect(await log.content(memory.id)).toBeNull()
    expect(await log.get(memory.id)).toEqual(memory)
    expect(await log.get("nope")).toBeNull()
    // Ids never reach outside the folder
    expect(await log.content("../index.jsonl")).toBeNull()
  })

  it("lists newest first, by target, path, chat, actor and time", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-changes-"))
    const log = new ChangeLog(owlit)
    const a = await log.append(entry({ kind: "doc", path: "a.md" }, { at: 1000, origin: { via: "tool", chatId: "c1" } }), "")
    const b = await log.append(entry({ kind: "comment", path: "a.md", part: "x" }, { at: 2000, actor: "p_1234abcd", origin: { via: "editor" } }))
    const c = await log.append(entry({ kind: "paper", path: "arxiv-1706.03762" }, { at: 3000, action: "create", origin: { via: "tool", chatId: "c1" } }))
    const ids = (list: Change[]) => list.map((x) => x.id)
    expect(ids(await log.list())).toEqual([c.id, b.id, a.id])
    expect(ids(await log.list({ path: "a.md" }))).toEqual([b.id, a.id])
    expect(ids(await log.list({ target: { kind: "doc", path: "a.md" } }))).toEqual([a.id])
    expect(ids(await log.list({ target: { kind: "comment", part: "x" } }))).toEqual([b.id])
    expect(ids(await log.list({ chatId: "c1" }))).toEqual([c.id, a.id])
    expect(ids(await log.list({ actor: "p_1234abcd" }))).toEqual([b.id])
    expect(ids(await log.list({ since: 2000 }))).toEqual([c.id, b.id])
  })

  it("keeps the newest of each path and nothing older than the keep window", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-changes-"))
    const log = new ChangeLog(owlit)
    const old = await log.append(entry({ kind: "doc", path: "old.md" }), "long ago")
    for (let i = 0; i < KEEP_PER_PATH + 5; i++) await log.append(entry({ kind: "doc", path: "a.md" }, { origin: { via: "tool", chatId: "c1" } }), `text ${i}`)
    await log.append(entry({ kind: "paper", path: "arxiv-1706.03762" }, { action: "create" }))
    // The first one, back-dated past the window
    const index = path.join(owlit, "versions/index.jsonl")
    writeFileSync(index, readFileSync(index, "utf8").replace(`"at":${old.at}`, `"at":${old.at - KEEP_MS - 1}`))

    expect(await log.cleanup()).toBe(6)
    const left = await log.list({ path: "a.md" })
    expect(left).toHaveLength(KEEP_PER_PATH)
    // The newest are the ones kept, with what they hold
    expect(await log.content(left[0].id)).toBe(`text ${KEEP_PER_PATH + 4}`)
    expect(await log.list({ path: "old.md" })).toEqual([])
    expect(await log.list({ path: "arxiv-1706.03762" })).toMatchObject([{ target: { kind: "paper" }, action: "create" }])
    // The dropped entries' files are gone too; the paper's entry never had one
    expect(readdirSync(path.join(owlit, "versions"))).toHaveLength(KEEP_PER_PATH + 1)
  })
})

describe("Recorder", () => {
  const recorder = (id?: string) => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-changes-"))
    const said: Change[] = []
    return { said, recorder: new Recorder(new ChangeLog(owlit), { profile: async () => ({ id }), added: ({ change }) => said.push(change) }) }
  }

  it("names the actor by the caller", async () => {
    const { recorder: r } = recorder("1234abcd")
    expect(await r.actorOf({ kind: "window" })).toBe("p_1234abcd")
    expect(await r.actorOf({ kind: "socket", chatId: "c1" })).toBe("o_1234abcd")
    expect(await r.actorOf({ kind: "socket", run: "docs.review:t1" })).toBe("o_1234abcd")
    expect(await r.actorOf({ kind: "socket" })).toBe("other")
    expect(await r.actorOf({ kind: "owlit" })).toBe("o_1234abcd")
    expect(await r.actorOf({ kind: "watcher", chatId: "c1" })).toBe("o_1234abcd")
    expect(await r.actorOf({ kind: "watcher" })).toBe("other")
  })

  it("stamps a doc's change from its texts and says it unless quiet", async () => {
    const { recorder: r, said } = recorder("1234abcd")
    const created = await r.doc({ kind: "socket", chatId: "c1" }, "a.md", null, "new")
    const updated = await r.doc({ kind: "window" }, "a.md", "new", "newer", { origin: { writeId: "w1" } }, { quiet: true })
    const deleted = await r.doc({ kind: "socket", chatId: "c1" }, "a.md", "newer", null)
    expect(created).toMatchObject({ actor: "o_1234abcd", action: "create", target: { kind: "doc", path: "a.md" }, origin: { via: "tool", chatId: "c1" }, afterHash: sha1("new") })
    expect(updated).toMatchObject({ actor: "p_1234abcd", action: "update", origin: { via: "editor", writeId: "w1" } })
    expect(deleted.action).toBe("delete")
    expect(deleted.afterHash).toBeUndefined()
    expect(said.map((c) => c.id)).toEqual([created.id, deleted.id])
  })
})
