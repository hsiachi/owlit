import type { PdfTry } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { migrate, standing, type AcquisitionV1 } from "./acquisition.ts"

const owlit = (ended: PdfTry["ended"], at: number, extra: Partial<PdfTry> = {}): PdfTry => ({ by: "owlit", ended, at, ...extra })
const you = (ended: PdfTry["ended"], at: number, extra: Partial<PdfTry> = {}): PdfTry => ({ by: "you", ended, at, ...extra })

describe("where a paper's PDF stands", () => {
  it("is finding before any try and while nothing could be reached", () => {
    expect(standing([])).toEqual({ state: "finding" })
    expect(standing([owlit("no-copy", 1), owlit("offline", 2)])).toMatchObject({ state: "finding", reason: { ended: "offline" } })
  })

  it("has it once the newest try brought the PDF", () => {
    expect(standing([owlit("no-copy", 1), you("pdf", 2)]).state).toBe("have-it")
  })

  it("has no PDF for the newest try's reason", () => {
    expect(standing([owlit("no-copy", 1)])).toMatchObject({ state: "no-pdf", reason: { ended: "no-copy" } })
    expect(standing([owlit("check", 1), you("not-offered", 2)])).toMatchObject({ state: "no-pdf", reason: { by: "you", ended: "not-offered" } })
    expect(standing([owlit("no-copy", 1), owlit("check", 2, { host: "dl.acm.org" })])).toMatchObject({ reason: { ended: "check", host: "dl.acm.org" } })
    expect(standing([owlit("no-copy", 1, { route: "arxiv" }), owlit("no-copy", 2, { route: "publisher:acm" })]).reason).toMatchObject({ route: "publisher:acm" })
  })

  it("keeps what another try learnt when owlit's own look finds no copy after it", () => {
    expect(standing([you("no-access", 1, { host: "dl.acm.org" }), owlit("no-copy", 2), owlit("no-copy", 3)])).toMatchObject({ state: "no-pdf", reason: { by: "you", ended: "no-access" } })
    // The look reached nothing, and then found nothing: still what the library said
    expect(standing([you("no-access", 1), owlit("offline", 2), owlit("no-copy", 3)]).reason).toMatchObject({ ended: "no-access" })
    // A check that stopped owlit's browser says less than what the user's browser, past it, was told
    expect(standing([you("nothing-came", 1), owlit("check", 2)]).reason).toMatchObject({ by: "you", ended: "nothing-came" })
    expect(standing([you("nothing-came", 1), owlit("not-there", 2)]).reason).toMatchObject({ by: "owlit", ended: "not-there" })
    // Before a PDF that was had and is gone, nothing counts
    expect(standing([you("no-access", 1), you("pdf", 2), owlit("no-copy", 3)]).reason).toMatchObject({ ended: "no-copy" })
  })
})

describe("an acquisition.json from before tries", () => {
  it("reads every old field as one try, oldest first, and keeps what carries over", () => {
    const old: AcquisitionV1 = {
      version: 1,
      result: "no_pdf",
      tried: [
        { route: "arxiv", url: "https://arxiv.org/pdf/1", status: 404, error: "Not found", at: 10 },
        { route: "unpaywall", url: "", error: "Not tried: Unpaywall needs a contact email in settings.", at: 11 },
        { route: "publisher:acm", url: "https://dl.acm.org/doi/pdf/10.1145/1", error: "dl.acm.org served a web page, not a PDF.", at: 12 },
      ],
      at: 12,
      dropHere: "/ws/library/papers/doi-10.1145-1/paper.pdf",
      needs: { reason: "challenge", route: "browser:acm", at: 20, host: "dl.acm.org" },
      looked: { outcome: "missing", at: 30, host: "dl.acm.org", title: "Page not found" },
      yourBrowser: { outcome: "refused", at: 40, host: "libproxy.example.edu", title: "Unauthorized" },
      looks: 3,
      sentToBrowser: { at: 39, page: false },
    }
    expect(migrate(old)).toEqual({
      version: 2,
      state: "no-pdf",
      tried: [
        { by: "owlit", ended: "no-copy", at: 10, route: "arxiv", host: "arxiv.org" },
        { by: "owlit", ended: "no-copy", at: 12, route: "publisher:acm", host: "dl.acm.org" },
        { by: "owlit", ended: "check", at: 20, route: "browser:acm", host: "dl.acm.org" },
        { by: "owlit", ended: "not-there", at: 30, host: "dl.acm.org", title: "Page not found" },
        { by: "you", ended: "not-offered", at: 40, host: "libproxy.example.edu", title: "Unauthorized" },
      ],
      dropHere: "/ws/library/papers/doi-10.1145-1/paper.pdf",
      looks: 3,
      sentToBrowser: { at: 39, page: false },
    })
  })

  it("maps each old word to one ending", () => {
    const base = { version: 1 as const, result: "no_pdf" as const, tried: [], at: 1, dropHere: "/p.pdf" }
    const ended = (extra: Partial<AcquisitionV1>) => migrate({ ...base, ...extra }).tried.map((t) => `${t.by} ${t.ended}`)
    expect(ended({ needs: { reason: "login", route: "browser:x", at: 2 } })).toEqual(["owlit sign-in"])
    expect(ended({ needs: { reason: "refused", route: "browser:x", at: 2 } })).toEqual(["owlit check"])
    expect(ended({ needs: { reason: "browser", route: "browser:acm", at: 2 } })).toEqual(["owlit check"])
    expect(ended({ yourBrowser: { outcome: "no-access", at: 2 } })).toEqual(["you no-access"])
    expect(ended({ yourBrowser: { outcome: "missing", at: 2 } })).toEqual(["you not-there"])
    expect(ended({ yourBrowser: { outcome: "missed", at: 2 } })).toEqual(["you nothing-came"])
    expect(ended({ looked: { outcome: "no-access", at: 2 } })).toEqual(["owlit no-access"])
    // A look that found nothing and recorded no route still has one try
    expect(ended({})).toEqual(["owlit no-copy"])
    // Nothing answered any route: one offline try, so the paper is still finding
    const offline = migrate({ ...base, tried: [{ route: "arxiv", url: "https://arxiv.org/pdf/1", status: 0, error: "Couldn't reach arxiv.org.", at: 5 }] })
    expect(offline).toMatchObject({ state: "finding", tried: [{ by: "owlit", ended: "offline", at: 5 }] })
  })

  it("keeps a PDF in place as had, by whoever placed it", () => {
    const placed = migrate({
      version: 1,
      result: "ok",
      route: "dropped",
      tried: [
        { route: "arxiv", url: "https://arxiv.org/pdf/1", status: 404, at: 1 },
        { route: "dropped", url: "/Users/me/Downloads/x.pdf", at: 2 },
      ],
      at: 2,
      dropHere: "/p.pdf",
      sha256: "abc",
    })
    expect(placed).toMatchObject({ state: "have-it", route: "dropped", sha256: "abc", tried: [{ ended: "no-copy" }, { by: "you", ended: "pdf", route: "dropped", at: 2 }] })
    expect(migrate({ version: 1, result: "ok", route: "arxiv", tried: [{ route: "arxiv", url: "", status: 200, at: 3 }], at: 3, dropHere: "/p.pdf" }).tried).toEqual([{ by: "owlit", ended: "pdf", at: 3, route: "arxiv" }])
  })
})
