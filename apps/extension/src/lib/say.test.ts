import { describe, expect, it } from "vitest"
import type { Outcome } from "./messages.ts"
import { badgeOf, cardOf, placesFor, sayIn, TAKEN, WAITING } from "./say.ts"

const card = (outcome: Outcome) => cardOf(outcome)

describe("cardOf", () => {
  it("says a paper added, with its PDF or what became of it, and offers to open it", () => {
    expect(card({ kind: "added", pdf: "saved", paperId: "p1" })).toMatchObject({ text: "Added to owlit with its PDF", stays: false, action: { label: "Open", do: { kind: "open-paper", paperId: "p1" } } })
    expect(card({ kind: "added", pdf: "not-a-pdf", host: "www.sciencedirect.com", paperId: "p1" })).toMatchObject({
      text: "Added to owlit",
      detail: "www.sciencedirect.com gave no PDF. owlit keeps looking.",
      stays: false,
    })
    expect(card({ kind: "added", pdf: "not-this-paper", paperId: "p1" }).detail).toBe("The PDF on this page is another paper's. owlit keeps looking.")
    expect(card({ kind: "added", pdf: "none-named", paperId: "p1" }).detail).toBe("The page names no PDF. owlit looks for one.")
  })

  it("stays with Allow when the PDF's site isn't one the extension may read", () => {
    expect(card({ kind: "added", pdf: "not-allowed", host: "journals.sagepub.com", paperId: "p1" })).toMatchObject({
      detail: "Let owlit read journals.sagepub.com to get its PDF with your access.",
      stays: true,
      action: { label: "Allow", do: { kind: "allow", host: "journals.sagepub.com" } },
    })
    expect(card({ kind: "needs-site", host: "journals.sagepub.com" })).toMatchObject({ text: "Let owlit read journals.sagepub.com", stays: true, action: { do: { kind: "allow", host: "journals.sagepub.com" } } })
  })

  it("says the PDF saved, and fades", () => {
    expect(card({ kind: "saved", paperId: "p1" })).toMatchObject({ text: "PDF saved to owlit", stays: false })
    expect(card({ kind: "taken", paperId: "p1", title: "Attention Is All You Need" })).toMatchObject({ text: "PDF saved to owlit", detail: "Attention Is All You Need" })
    expect(card({ kind: "no-pdf", host: "dl.acm.org" })).toMatchObject({ text: "dl.acm.org gave no PDF", detail: "owlit keeps looking.", stays: false })
  })

  it("gives every failure its next step", () => {
    expect(card({ kind: "failed", message: "owlit couldn't read what the extension sent." })).toMatchObject({ text: "owlit couldn't read what the extension sent", detail: "Press owlit's button to try again.", stays: true })
    expect(card({ kind: "no-workspace" })).toMatchObject({ detail: "Open one in owlit, then press the button again.", action: { label: "Open owlit", do: { kind: "open-owlit" } } })
    expect(card({ kind: "unpaired" })).toMatchObject({ stays: true, action: { label: "Connect", do: { kind: "connect" } } })
  })

  it("asks for owlit to be opened when it isn't running, with nothing to press", () => {
    expect(card({ kind: "offline" })).toEqual({ text: "owlit isn't open", detail: "Open it, then press the button again.", stays: true, close: "Close" })
  })

  it("says what a site waits for, counted, and that owlit goes on once through", () => {
    expect(card({ kind: "wait", wait: { kind: "sign-in", host: "sagepub.com", papers: 3 } })).toMatchObject({ text: "3 papers wait for your sign-in here", detail: "Going on once you're through.", stays: true, key: "wait:sagepub.com" })
    expect(card({ kind: "wait", wait: { kind: "check", host: "acm.org", papers: 1 } }).text).toBe("1 paper waits for you to pass the check here")
    expect(card({ kind: "wait", wait: { kind: "blocked", host: "bmj.com", papers: 2 } })).toMatchObject({ text: "bmj.com blocks this browser", detail: "Another network usually gets past it; owlit goes on with 2 papers then." })
    expect(card({ kind: "wait", wait: { kind: "permission", host: "jstor.org", papers: 2 } })).toMatchObject({ text: "2 papers wait for owlit to read jstor.org", action: { do: { kind: "allow", host: "jstor.org" } } })
    expect(card({ kind: "through", host: "sagepub.com", papers: 3 })).toMatchObject({ text: "You're through", detail: "owlit goes on with 3 papers.", stays: false })
  })

  it("ends every detail with a full stop and no headline with one", () => {
    const outcomes: Outcome[] = [
      ...(["saved", "none-named", "not-a-pdf", "not-this-paper", "not-allowed"] as const).map((pdf) => ({ kind: "added" as const, pdf, host: "x.org", paperId: "p" })),
      { kind: "saved", paperId: "p" },
      { kind: "taken", paperId: "p", title: "A title" },
      { kind: "no-pdf", host: "x.org" },
      { kind: "not-this-paper" },
      { kind: "has-pdf", paperId: "p" },
      { kind: "none-named", paperId: "p" },
      { kind: "no-paper" },
      { kind: "no-paper", listing: "Google Scholar" },
      { kind: "unknown-pdf" },
      { kind: "needs-site", host: "x.org" },
      { kind: "no-workspace" },
      { kind: "offline" },
      { kind: "unpaired" },
      { kind: "pairing" },
      { kind: "connected" },
      { kind: "elsewhere", name: "Owlit Dev" },
      { kind: "failed", message: "owlit couldn't read what the extension sent." },
      { kind: "wait", wait: { kind: "sign-in", host: "x.org", papers: 2 } },
      { kind: "through", host: "x.org", papers: 2 },
    ]
    for (const outcome of outcomes) {
      const { text, detail } = card(outcome)
      expect(text, outcome.kind).not.toMatch(/[.;]$/)
      if (detail && outcome.kind !== "taken") expect(detail, outcome.kind).toMatch(/\.$/)
    }
  })
})

describe("placesFor", () => {
  it("decides the connection and the workspace in the popup, and says the rest in the page", () => {
    expect(placesFor({ kind: "unpaired" })).toEqual(["popup", "card"])
    expect(placesFor({ kind: "no-workspace" })).toEqual(["popup", "card"])
    expect(placesFor({ kind: "elsewhere", name: "Owlit Dev" })).toEqual(["popup", "card"])
    expect(placesFor({ kind: "added", pdf: "saved", paperId: "p" })).toEqual(["card", "popup"])
    expect(placesFor({ kind: "offline" })).toEqual(["card", "popup"])
    expect(placesFor({ kind: "needs-site", host: "x.org" })).toEqual(["card", "popup"])
  })
})

describe("sayIn", () => {
  const shows = (can: ("popup" | "card")[]) => {
    const tried: string[] = []
    return { tried, show: async (place: "popup" | "card") => (tried.push(place), can.includes(place)) }
  }

  it("draws a result in the page, and opens the popup only when the page takes no card", async () => {
    const page = shows(["card", "popup"])
    expect(await sayIn({ kind: "saved", paperId: "p" }, page.show)).toBe("card")
    expect(page.tried).toEqual(["card"])
    const browsersOwn = shows(["popup"])
    expect(await sayIn({ kind: "saved", paperId: "p" }, browsersOwn.show)).toBe("popup")
    expect(browsersOwn.tried).toEqual(["card", "popup"])
  })

  it("decides connecting in the popup, and in the card where the browser won't open one", async () => {
    expect(await sayIn({ kind: "unpaired" }, shows(["card", "popup"]).show)).toBe("popup")
    const firefox = shows(["card"])
    expect(await sayIn({ kind: "unpaired" }, firefox.show)).toBe("card")
    expect(firefox.tried).toEqual(["popup", "card"])
    expect(await sayIn({ kind: "unpaired" }, shows([]).show)).toBeUndefined()
  })
})

describe("badgeOf", () => {
  it("marks a PDF in owlit green and a paper still without one amber", () => {
    expect(badgeOf({ kind: "added", pdf: "saved", paperId: "p" })).toEqual({ text: "✓", color: TAKEN })
    expect(badgeOf({ kind: "added", pdf: "not-a-pdf", paperId: "p" })).toEqual({ text: "•", color: WAITING })
    expect(badgeOf({ kind: "saved", paperId: "p" })).toEqual({ text: "✓", color: TAKEN })
    expect(badgeOf({ kind: "has-pdf", paperId: "p" })?.text).toBe("")
    expect(badgeOf({ kind: "offline" })).toBeUndefined()
  })
})
