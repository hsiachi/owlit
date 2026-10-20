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

  it("shows a paragraph someone else removed, after the one it followed, and not one rewritten", () => {
    const current = "回放评分更低。\n\nKelly 2015 is close.\n"
    const steps = [{ actor: "other" as const, at: 20, before: base, after: current }]
    expect(passagesSince(base, current, steps, ME)).toEqual([{ text: "The method works well.", actor: "other", at: 20, removed: { after: "回放评分更低。" } }])
    // Taken out by the person: theirs to know
    expect(passagesSince(base, current, [{ ...steps[0]!, actor: ME }], ME)).toEqual([])
    // Rewritten, not removed: only its new text shows
    const rewritten = "回放评分更低。\n\nThe method works, mostly.\n\nKelly 2015 is close.\n"
    expect(passagesSince(base, rewritten, [{ ...steps[0]!, after: rewritten }], ME).map((p) => p.removed)).toEqual([undefined])
    // The first paragraph, removed: at the top
    const top = "The method works well.\n\nKelly 2015 is close.\n"
    expect(passagesSince(base, top, [{ ...steps[0]!, after: top }], ME)).toMatchObject([{ text: "回放评分更低。", removed: { after: null } }])
  })
})
