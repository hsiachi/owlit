import { describe, expect, it } from "vitest"
import { parseYears } from "./discover.ts"

describe("parseYears", () => {
  it("reads a year, a range and open ends", () => {
    expect(parseYears("2023")).toEqual({ from: 2023, to: 2023 })
    expect(parseYears("2019-2023")).toEqual({ from: 2019, to: 2023 })
    expect(parseYears("2023-")).toEqual({ from: 2023, to: undefined })
    expect(parseYears("-2023")).toEqual({ from: undefined, to: 2023 })
    expect(parseYears(" ")).toBeUndefined()
  })

  it("refuses what isn't a year", () => {
    expect(() => parseYears("last year")).toThrow(/year should look like/)
    expect(() => parseYears("2024-2020")).toThrow(/ends before it starts/)
  })
})
