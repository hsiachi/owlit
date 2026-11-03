import { describe, expect, it } from "vitest"
import type { Outcome } from "./messages.ts"
import { badgeOf, cardOf, gettingLine, placesFor, savedPaper, sayIn, siteLine, TAKEN, WAITING, walkCard } from "./say.ts"

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
      detail: "owlit doesn't have permission for journals.sagepub.com yet. Allow it, and owlit saves the PDF.",
      stays: true,
      action: { label: "Allow", do: { kind: "allow", host: "journals.sagepub.com" } },
    })
    expect(card({ kind: "needs-site", host: "journals.sagepub.com" })).toMatchObject({
      text: "owlit needs your permission for journals.sagepub.com",
      detail: "Allow it, and owlit gets the PDF there with your access.",
      stays: true,
      action: { do: { kind: "allow", host: "journals.sagepub.com" } },
    })
  })

  it("points at the page's own PDF button for a Library paper without its PDF, whatever the page names", () => {
    expect(card({ kind: "none-named", paperId: "p1" })).toEqual({
      text: "owlit needs this PDF",
      detail: "Click the PDF button on this page. owlit saves the PDF when it opens.",
      stays: false,
      close: "Close",
    })
  })

  it("says why a Library paper's PDF the user opened wasn't saved, with its one fix", () => {
    expect(card({ kind: "not-saved", why: "permission", host: "academic.oup.com", paperId: "p1" })).toMatchObject({
      text: "Couldn't save this PDF",
      detail: "owlit doesn't have permission for academic.oup.com yet. Allow it, and owlit saves this PDF.",
      stays: true,
      action: { label: "Allow", do: { kind: "allow", host: "academic.oup.com" } },
    })
    expect(card({ kind: "not-saved", why: "off", paperId: "p1" })).toMatchObject({
      text: "Couldn't save this PDF",
      detail: "Saving PDFs you open is turned off.",
      stays: true,
      action: { label: "Turn on", do: { kind: "take-pdfs" } },
    })
    expect(card({ kind: "not-this-paper" })).toMatchObject({ text: "This PDF is another paper's", detail: "owlit keeps looking." })
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

  it("says what a site waits for, counted, in the app's words, and that owlit goes on once through", () => {
    const wait = (kind: "sign-in" | "check" | "blocked" | "permission", host: string, papers: number, proxied = false) => card({ kind: "wait", wait: { kind, host, papers, proxied } })
    expect(wait("sign-in", "sagepub.com", 3)).toMatchObject({ text: "3 papers need you to sign in at sagepub.com", detail: "owlit goes on by itself once you're signed in.", stays: true, key: "wait:sagepub.com" })
    expect(wait("sign-in", "tlink.lib.tsinghua.edu.cn", 23, true).text).toBe("23 papers need you to sign in to your library")
    expect(wait("sign-in", "tlink.lib.tsinghua.edu.cn", 1, true).text).toBe("1 paper needs you to sign in to your library")
    expect(wait("check", "oup.com", 1)).toMatchObject({ text: "1 paper needs you to verify you're human on oup.com", detail: "Verify on this page; owlit goes on by itself once you have." })
    expect(wait("blocked", "bmj.com", 2)).toMatchObject({ text: "bmj.com blocks your browser", detail: "Another network usually gets past it; owlit goes on with 2 papers then." })
    expect(wait("permission", "jstor.org", 2)).toMatchObject({ text: "2 papers need your permission for jstor.org", action: { do: { kind: "allow", host: "jstor.org" } } })
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
      { kind: "not-saved", why: "permission", host: "x.org", paperId: "p" },
      { kind: "not-saved", why: "off", paperId: "p" },
      { kind: "no-workspace" },
      { kind: "offline" },
      { kind: "unpaired" },
      { kind: "pairing" },
      { kind: "connected" },
      { kind: "elsewhere", name: "Owlit Dev" },
      { kind: "failed", message: "owlit couldn't read what the extension sent." },
      ...(["sign-in", "check", "blocked", "permission"] as const).map((kind) => ({ kind: "wait" as const, wait: { kind, host: "x.org", papers: 2, proxied: false } })),
      { kind: "wait", wait: { kind: "sign-in", host: "x.org", papers: 2, proxied: true } },
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
    expect(badgeOf({ kind: "not-saved", why: "off", paperId: "p" })).toEqual({ text: "!", color: WAITING })
    expect(badgeOf({ kind: "none-named", paperId: "p" })).toEqual({ text: "•", color: WAITING })
    expect(badgeOf({ kind: "offline" })).toBeUndefined()
  })
})

describe("gettingLine", () => {
  it("ties the page's paper to what owlit is getting, and to what holds up the most of it", () => {
    expect(gettingLine(34, { kind: "sign-in", host: "tlink.lib.tsinghua.edu.cn", papers: 23, proxied: true })).toBe("One of the 34 papers owlit is getting · 23 still need you to sign in to your library")
    expect(gettingLine(5, { kind: "sign-in", host: "sagepub.com", papers: 1, proxied: false })).toBe("One of the 5 papers owlit is getting · 1 still needs you to sign in at sagepub.com")
    expect(gettingLine(5, { kind: "check", host: "oup.com", papers: 2, proxied: false })).toBe("One of the 5 papers owlit is getting · 2 still need you to verify you're human on oup.com")
    expect(gettingLine(5, { kind: "permission", host: "jstor.org", papers: 2, proxied: false })).toBe("One of the 5 papers owlit is getting · 2 still need your permission for jstor.org")
  })

  it("says the count alone when nothing the user can do holds it up", () => {
    expect(gettingLine(1)).toBe("The one paper owlit is getting")
    expect(gettingLine(5, { kind: "blocked", host: "bmj.com", papers: 2, proxied: false })).toBe("One of the 5 papers owlit is getting")
  })
})

describe("walkCard", () => {
  const paper = (n: number, total: number, saved = 0) => walkCard({ kind: "paper", paperId: `p${n}`, url: `https://doi.org/10.1/${n}`, n, total, saved })

  it("says which paper of how many, what to do on its page, and offers Skip and Next paper", () => {
    expect(paper(1, 10)).toEqual({
      text: "Paper 1 of 10 to download manually",
      detail: "Click the PDF button on this page; owlit saves it. No PDF here? Skip it.",
      stays: true,
      close: "Close",
      steps: [
        { label: "Skip", do: { kind: "walk", paperId: "p1", skip: true } },
        { label: "Next paper", do: { kind: "walk", paperId: "p1", skip: false } },
      ],
    })
  })

  it("counts the PDFs saved so far, and finishes on the last paper", () => {
    expect(paper(4, 10, 2)).toMatchObject({ text: "Paper 4 of 10 to download manually", note: "2 saved" })
    expect(paper(10, 10, 3).steps?.map((s) => s.label)).toEqual(["Skip", "Finish"])
    expect(paper(1, 1)).toMatchObject({ text: "One paper to download manually", steps: [{ label: "Skip" }, { label: "Finish" }] })
  })

  it("says how it went at the end, and stays until closed", () => {
    expect(walkCard({ kind: "done", saved: 3, total: 10 })).toMatchObject({ text: "Done: saved 3 of 10", stays: true, action: { label: "Open owlit", do: { kind: "open-owlit" } } })
    expect(walkCard({ kind: "done", saved: 10, total: 10 }).text).toBe("Done: saved all 10 PDFs")
    expect(walkCard({ kind: "done", saved: 1, total: 1 }).text).toBe("Done: saved the PDF")
  })
})

describe("savedPaper", () => {
  it("names the paper a click saved the PDF of, and nothing otherwise", () => {
    expect(savedPaper({ kind: "saved", paperId: "p" })).toBe("p")
    expect(savedPaper({ kind: "taken", paperId: "p", title: "T" })).toBe("p")
    expect(savedPaper({ kind: "added", pdf: "saved", paperId: "p" })).toBe("p")
    expect(savedPaper({ kind: "added", pdf: "none-named", paperId: "p" })).toBeUndefined()
    expect(savedPaper({ kind: "has-pdf", paperId: "p" })).toBeUndefined()
  })
})

describe("siteLine", () => {
  it("says owlit going on at the site, on a page of a paper owlit is getting there too", () => {
    const going = { host: "tandfonline.com", done: 1, total: 5 }
    const state = { going, getting: { papers: 5 }, page: null }
    expect(siteLine(state)).toEqual({ text: "Going on · 1 of 5" })
    // Going on outweighs a wait the page is past
    expect(siteLine({ ...state, wait: { kind: "check", host: "tandfonline.com", papers: 2, proxied: false } })).toEqual({ text: "Going on · 1 of 5" })
  })

  it("says what the site waits for, else nothing", () => {
    expect(siteLine({ wait: { kind: "check", host: "tandfonline.com", papers: 2, proxied: false } })?.text).toBe(cardOf({ kind: "wait", wait: { kind: "check", host: "tandfonline.com", papers: 2, proxied: false } }).text)
    expect(siteLine({})).toBeUndefined()
  })
})
