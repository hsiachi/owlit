import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { heldSince } from "./lock.ts"

const lock = (pid: number, since = Date.now()) => ({ pid, workspace: "/ws", since })

describe("heldSince", () => {
  it("frees a lock only when no process has its pid", async () => {
    // A process that has exited: its pid names nobody now
    const { pid } = spawnSync(process.execPath, ["-e", ""])
    let asked = false
    expect(await heldSince(lock(pid!), async () => ((asked = true), 0))).toBe(false)
    expect(asked).toBe(false)
  })

  it("keeps a live holder's lock when ps can't say when it started", async () => {
    expect(await heldSince(lock(process.pid), () => Promise.reject(new Error("ps: not permitted")))).toBe(true)
    expect(await heldSince(lock(process.pid), async () => Number.NaN)).toBe(true)
  })

  it("frees the lock of a pid now used by a process that started after it was taken", async () => {
    const since = Date.now()
    expect(await heldSince(lock(process.pid, since), async () => since + 60_000)).toBe(false)
    expect(await heldSince(lock(process.pid, since), async () => since - 60_000)).toBe(true)
  })
})
