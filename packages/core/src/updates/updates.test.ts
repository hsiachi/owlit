import type { BuildInfo, UpdatesView } from "@owlit/protocol"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdaterHost } from "../host.ts"
import { CHECK_EVERY_MS, changelogSection, FIRST_CHECK_MS, RETRY_MS, Updates, type UpdatesOptions } from "./updates.ts"
import { compareVersions } from "./version.ts"

// A feed that answers what the test says, and a download the test moves along by hand
function fakeUpdater(answer: () => Promise<string | undefined>) {
  const listeners = { progress: [] as ((p: number) => void)[], downloaded: [] as ((v: string) => void)[], error: [] as ((e: Error) => void)[] }
  const updater = {
    checks: 0,
    installs: 0,
    blocked: undefined as UpdaterHost["blocked"],
    check: async () => {
      updater.checks++
      return answer()
    },
    onProgress: (l: (p: number) => void) => void listeners.progress.push(l),
    onDownloaded: (l: (v: string) => void) => void listeners.downloaded.push(l),
    onError: (l: (e: Error) => void) => void listeners.error.push(l),
    install: () => void updater.installs++,
    progress: (p: number) => listeners.progress.forEach((l) => l(p)),
    downloaded: (v: string) => listeners.downloaded.forEach((l) => l(v)),
    fail: (e: Error) => listeners.error.forEach((l) => l(e)),
  }
  return updater
}

let dir: string
const all: Updates[] = []
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "owlit-updates-"))
})
afterEach(() => {
  for (const u of all.splice(0)) u.dispose()
  vi.useRealTimers()
})

function make(build: Partial<BuildInfo>, more: Partial<UpdatesOptions> = {}) {
  const views: UpdatesView[] = []
  const updates = new Updates({
    build: { version: "0.3.0", channel: "release", ...build },
    userDataDir: dir,
    onboarded: async () => false,
    answering: () => 0,
    notify: (view) => void views.push(view),
    ...more,
  })
  all.push(updates)
  return { updates, views }
}

const record = () => JSON.parse(readFileSync(path.join(dir, "updates.json"), "utf8"))

describe("which builds update themselves", () => {
  it("a local or dev build doesn't, and keeps no record of the version that ran", async () => {
    const updater = fakeUpdater(async () => "9.0.0")
    for (const channel of ["local", "dev"] as const) {
      const { updates } = make({ channel }, { updater })
      expect((await updates.view()).status).toEqual({ kind: "off", reason: "build" })
      expect(await updates.check()).toEqual({ kind: "off", reason: "build" })
    }
    expect(updater.checks).toBe(0)
    expect(() => record()).toThrow()
  })

  it("a release says why when its host can't (not signed, or run from the dmg)", async () => {
    const updater = fakeUpdater(async () => undefined)
    updater.blocked = async () => "location"
    const { updates } = make({}, { updater })
    expect((await updates.view()).status).toEqual({ kind: "off", reason: "location" })
  })
})

describe("Updated to", () => {
  const changelog = () => {
    const file = path.join(dir, "CHANGELOG.md")
    writeFileSync(file, "# Changelog\n\n## 0.3.1\n\nFaster threads.\n\n## 0.3.0\n\nOwlit updates itself.\n")
    return file
  }

  it("shows once on the first start of a higher version, with that version's notes", async () => {
    const first = make({ version: "0.3.0" }).updates
    await first.start()
    await first.dispose()
    expect(record().ranVersion).toBe("0.3.0")
    const { updates } = make({ version: "0.3.1" }, { changelog: changelog() })
    expect((await updates.view()).updated).toEqual({ version: "0.3.1", notes: "Faster threads." })
    await updates.seen()
    expect((await updates.view()).updated).toBeUndefined()
    await updates.dispose()
    // Started again: nothing new
    const again = make({ version: "0.3.1" }).updates
    expect((await again.view()).updated).toBeUndefined()
  })

  it("not on a first install, a downgrade, or a release with no record and no workspace yet", async () => {
    const first = make({ version: "0.3.0" }).updates
    expect((await first.view()).updated).toBeUndefined()
    // Its record written before the older version starts, as when one quits before the next opens
    await first.dispose()
    expect(record().ranVersion).toBe("0.3.0")
    const older = make({ version: "0.2.9" }).updates
    expect((await older.view()).updated).toBeUndefined()
    await older.dispose()
    expect(record().ranVersion).toBe("0.2.9")
  })

  it("from a version that kept no record (0.2.0), when a workspace was opened here before", async () => {
    const { updates } = make({ version: "0.3.0" }, { onboarded: async () => true, changelog: changelog() })
    expect((await updates.view()).updated).toEqual({ version: "0.3.0", notes: "Owlit updates itself." })
  })
})

describe("checking", () => {
  it("checks shortly after the start, then not again for a day; a tick after that checks", async () => {
    vi.useFakeTimers()
    const updater = fakeUpdater(async () => undefined)
    const { updates } = make({}, { updater })
    await updates.start()
    expect(updater.checks).toBe(0)
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(updater.checks).toBe(1)
    expect((await updates.view()).checkedAt).toBe(Date.now())
    // The hourly tick after a day has passed since that check
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - FIRST_CHECK_MS - 1)
    expect(updater.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * 3_600_000)
    expect(updater.checks).toBe(2)
  })

  it("a start within a day of the last check doesn't check again; the switch off doesn't check at all", async () => {
    vi.useFakeTimers()
    const updater = fakeUpdater(async () => undefined)
    writeFileSync(path.join(dir, "updates.json"), JSON.stringify({ checkedAt: Date.now() - 3_600_000, ranVersion: "0.3.0" }))
    await make({}, { updater }).updates.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(updater.checks).toBe(0)
    all.splice(0).forEach((u) => u.dispose())

    writeFileSync(path.join(dir, "updates.json"), JSON.stringify({ auto: false, ranVersion: "0.3.0" }))
    const off = make({}, { updater }).updates
    await off.start()
    await vi.advanceTimersByTimeAsync(2 * CHECK_EVERY_MS)
    expect(updater.checks).toBe(0)
    // By hand still works
    expect(await off.check()).toEqual({ kind: "current", version: "0.3.0" })
  })

  it("a failed check by itself stays quiet and tries again after a few hours; by hand it says what went wrong", async () => {
    vi.useFakeTimers()
    let fail = true
    const updater = fakeUpdater(async () => {
      if (fail) throw new Error("net::ERR_INTERNET_DISCONNECTED")
      return undefined
    })
    const { updates } = make({}, { updater })
    await updates.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(updater.checks).toBe(1)
    expect((await updates.view()).status).toEqual({ kind: "idle" })
    await vi.advanceTimersByTimeAsync(RETRY_MS - 3_600_000)
    expect(updater.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * 3_600_000)
    expect(updater.checks).toBe(2)

    const byHand = await updates.check()
    expect(byHand).toMatchObject({ kind: "failed", message: expect.stringContaining("GitHub couldn't be reached") })
    expect((await updates.view()).status.kind).toBe("failed")
    fail = false
    expect(await updates.check()).toEqual({ kind: "current", version: "0.3.0" })
  })

  it("two checks at once ask the feed once", async () => {
    let answer!: (v: string | undefined) => void
    const updater = fakeUpdater(() => new Promise((resolve) => (answer = resolve)))
    const { updates } = make({}, { updater })
    await updates.start()
    const both = Promise.all([updates.check(), updates.check()])
    await vi.waitFor(() => expect(updater.checks).toBe(1))
    answer(undefined)
    expect(await both).toEqual([
      { kind: "current", version: "0.3.0" },
      { kind: "current", version: "0.3.0" },
    ])
  })
})

describe("a newer version", () => {
  it("downloads, is ready, and installs on Restart unless a chat is answering", async () => {
    let answering = 1
    const updater = fakeUpdater(async () => "0.3.1")
    const { updates, views } = make({}, { updater, answering: () => answering })
    expect(await updates.check()).toEqual({ kind: "found", version: "0.3.1" })
    expect((await updates.view()).status).toEqual({ kind: "downloading", version: "0.3.1" })
    updater.progress(41.7)
    updater.progress(41.9)
    await vi.waitFor(() => expect(views.filter((v) => v.status.kind === "downloading" && v.status.percent === 41)).toHaveLength(1))
    // While it downloads, another check asks nothing
    expect(await updates.check()).toEqual({ kind: "found", version: "0.3.1" })
    expect(updater.checks).toBe(1)
    await expect(updates.restart(false)).rejects.toThrow()

    updater.downloaded("0.3.1")
    expect((await updates.view()).status).toEqual({ kind: "ready", version: "0.3.1" })
    expect(await updates.restart(false)).toEqual({ answering: 1 })
    expect(updater.installs).toBe(0)
    expect(await updates.restart(true)).toEqual({ answering: 1 })
    expect(updater.installs).toBe(1)
    answering = 0
    await updates.restart(false)
    expect(updater.installs).toBe(2)
  })

  it("a download that breaks shows as failed, and the next check starts again", async () => {
    const updater = fakeUpdater(async () => "0.3.1")
    const { updates } = make({}, { updater })
    await updates.check()
    updater.fail(new Error("sha512 checksum mismatch"))
    expect((await updates.view()).status).toMatchObject({ kind: "failed", message: expect.stringContaining("sha512 checksum mismatch") })
    expect(await updates.check()).toEqual({ kind: "found", version: "0.3.1" })
    expect(updater.checks).toBe(2)
  })
})

describe("versions", () => {
  it("orders x.y.z numerically, a pre-release before its release", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1)
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0)
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1)
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1)
    expect(compareVersions("v0.3.1", "0.3.0+abc")).toBe(1)
  })

  it("finds a version's CHANGELOG section without its heading", () => {
    const text = "# Changelog\n\n## 0.3.1\n\nA\n\n- b\n\n## 0.3.0\n\nC\n"
    expect(changelogSection(text, "0.3.1")).toBe("A\n\n- b")
    expect(changelogSection(text, "0.3.0")).toBe("C")
    expect(changelogSection(text, "0.2.0")).toBeUndefined()
  })
})
