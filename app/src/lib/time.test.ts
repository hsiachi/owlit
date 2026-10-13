import { describe, expect, it } from "vitest"
import { timeStamp } from "./time"

describe("timeStamp", () => {
  // This year, since a date in another year also names its year
  const year = new Date().getFullYear()
  const now = new Date(year, 9, 13, 16, 0).getTime()

  it("says only the clock time for today", () => {
    expect(timeStamp(new Date(year, 9, 13, 12, 1).getTime(), now)).toBe("12:01 PM")
  })

  it("adds the date for any other day, so a days-old message doesn't read as today's", () => {
    expect(timeStamp(new Date(year, 9, 9, 12, 1).getTime(), now)).toBe("Oct 9, 12:01 PM")
  })
})
