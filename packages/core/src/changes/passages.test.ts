import { describe, expect, it } from "vitest"
import { ME, MY_OWLIT } from "../test-util.ts"
import { passagesSince } from "./passages.ts"

describe("passagesSince", () => {
  const base = "回放评分更低。\n\nThe method works well.\n\nKelly 2015 is close.\n"

  it("shows a paragraph Owlit changed and not one the person changed", () => {
    const owlit = "回放评分略低，方向一致。\n\nThe method works well.\n\nKelly 2015 is close.\n"
    const current = "回放评分略低，方向一致。\n\nThe method works, mostly.\n\nKelly 2015 is close.\n"
    const steps = [
      { actor: MY_OWLIT, at: 20, before: base, after: owlit },
      { actor: ME, at: 30, before: owlit, after: current },
    ]
    expect(passagesSince(base, current, steps, ME)).toEqual([{ text: "回放评分略低，方向一致。", actor: MY_OWLIT, at: 20 }])
  })

  it("leaves Owlit's paragraph out once the person rewrote it, and shows nothing the steps don't account for", () => {
    const owlit = `${base}\nOwlit's new paragraph.\n`
    const current = `${base}\nMy take on Owlit's paragraph.\n`
    const steps = [
      { actor: MY_OWLIT, at: 20, before: base, after: owlit },
      { actor: ME, at: 30, before: owlit, after: current },
    ]
    expect(passagesSince(base, current, steps, ME)).toEqual([])
    expect(passagesSince(base, `${base}\nFrom nowhere.\n`, [], ME)).toEqual([])
  })
})
