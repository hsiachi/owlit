import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { keepInTemp } from "./fs-util.ts"

describe("keepInTemp", () => {
  let dir: string
  const stops: Array<() => void> = []
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "owlit-keep-"))
  })
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    await rm(dir, { recursive: true, force: true })
  })

  it("touches the file so it doesn't look unused", async () => {
    const file = path.join(dir, "pointer.json")
    await writeFile(file, "{}\n")
    const old = new Date(Date.now() - 5 * 24 * 60 * 60_000)
    await utimes(file, old, old)
    stops.push(keepInTemp(file, () => "{}\n", { everyMs: 10 }))
    await vi.waitFor(async () => expect((await stat(file)).atimeMs).toBeGreaterThan(old.getTime() + 60_000))
  })

  it("writes the file again when it was deleted", async () => {
    const file = path.join(dir, "pointer.json")
    await writeFile(file, "first\n")
    stops.push(keepInTemp(file, () => "kept\n", { everyMs: 10 }))
    await rm(file)
    await vi.waitFor(async () => expect(await readFile(file, "utf8")).toBe("kept\n"))
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
})
