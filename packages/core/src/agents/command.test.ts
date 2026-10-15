import { describe, expect, it } from "vitest"
import { pathFinder } from "./command.ts"

describe("pathFinder", () => {
  it("keeps the shell's PATH once it has it", async () => {
    let asked = 0
    const find = pathFinder(async () => (asked++, "/shell/bin"))
    expect(await find()).toMatch(/^\/shell\/bin:/)
    expect(await find()).toMatch(/^\/shell\/bin:/)
    expect(asked).toBe(1)
  })

  it("shares one question between callers while the shell answers", async () => {
    let asked = 0
    const find = pathFinder(async () => (asked++, "/shell/bin"))
    await Promise.all([find(), find(), find()])
    expect(asked).toBe(1)
  })

  // macOS reopening Owlit at login: the shell timed out once, and Claude Code's adapter (under nvm) stayed
  // out of reach until Owlit was quit
  it("asks the shell again after a miss, once the wait is over", async () => {
    let clock = 0
    const answers: (string | null)[] = [null, "/nvm/bin"]
    let asked = 0
    const find = pathFinder(async () => answers[asked++] ?? null, 30_000, () => clock)
    expect(await find()).not.toContain("/nvm/bin")
    clock = 10_000
    expect(await find()).not.toContain("/nvm/bin")
    expect(asked).toBe(1)
    clock = 30_000
    expect(await find()).toMatch(/^\/nvm\/bin:/)
    expect(asked).toBe(2)
  })
})
