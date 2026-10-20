import { describe, expect, it } from "vitest"
import { serial } from "./serial.ts"

describe("serial", () => {
  it("runs a read-modify-write whole before the next one starts", async () => {
    const queue = serial()
    let stored: string[] = []
    // Each awaits between its read and its write, as a storage call does
    const add = (item: string) =>
      queue(async () => {
        const read = stored
        await Promise.resolve()
        await Promise.resolve()
        stored = [...read, item]
      })
    await Promise.all([add("a"), add("b"), add("c")])
    expect(stored).toEqual(["a", "b", "c"])
  })

  it("goes on after a task that failed, and hands each caller its own result", async () => {
    const queue = serial()
    const failed = queue(() => Promise.reject(new Error("no")))
    const next = queue(() => 2)
    await expect(failed).rejects.toThrow("no")
    await expect(next).resolves.toBe(2)
  })

  it("lets a read wait for the writes queued before it", async () => {
    const queue = serial()
    const order: string[] = []
    void queue(async () => {
      await Promise.resolve()
      order.push("write")
    })
    await queue(() => order.push("read"))
    expect(order).toEqual(["write", "read"])
  })
})
