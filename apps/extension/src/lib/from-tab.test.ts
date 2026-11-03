import type { WorkItem } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { fromTab, inTabItem } from "./from-tab.ts"

const TLINK = "tlink.lib.tsinghua.edu.cn"
const EZ = "ezproxy.lib.example.edu"

describe("a paper's address as a tab past the check reaches it", () => {
  it("is the address itself on the tab's own origin", () => {
    expect(fromTab("https://dl.acm.org/doi/pdf/1", "https://dl.acm.org/doi/2")).toBe("https://dl.acm.org/doi/pdf/1")
  })

  it("moves onto the tab's host when both are hosts of one site", () => {
    expect(fromTab("https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/1", "https://rss.onlinelibrary.wiley.com/doi/10.1111/1")).toBe("https://rss.onlinelibrary.wiley.com/doi/pdfdirect/10.1111/1")
  })

  it("leaves another site's address alone", () => {
    expect(fromTab("https://watermark.silverchair.com/x.pdf?token=1", "https://academic.oup.com/jamia/article/1")).toBeUndefined()
  })

  it("comes out of a login-url proxy's link, encoded or not, when the tab stands at the publisher", () => {
    const tab = "https://www.tandfonline.com/doi/10.1080/9"
    expect(fromTab(`https://${TLINK}/go?url=https://www.tandfonline.com/doi/pdf/10.1080/1`, tab, TLINK)).toBe("https://www.tandfonline.com/doi/pdf/10.1080/1")
    expect(fromTab(`https://${TLINK}/go?url=${encodeURIComponent("https://www.tandfonline.com/doi/pdf/10.1080/1")}`, tab, TLINK)).toBe("https://www.tandfonline.com/doi/pdf/10.1080/1")
  })

  it("keeps a proxy's link whose target is another site than the tab's", () => {
    expect(fromTab(`https://${TLINK}/go?url=https://www.science.org/doi/pdf/1`, "https://www.tandfonline.com/doi/1", TLINK)).toBeUndefined()
  })

  it("goes under a host-rewriting proxy's name for the publisher when the tab stands there", () => {
    expect(fromTab("https://www.sciencedirect.com/science/article/pii/S1/pdfft", `https://www-sciencedirect-com.${EZ}/science/article/pii/S2`, EZ)).toBe(`https://www-sciencedirect-com.${EZ}/science/article/pii/S1/pdfft`)
  })

  it("never moves one publisher's rewritten address onto another's under the same proxy", () => {
    expect(fromTab(`https://onlinelibrary-wiley-com.${EZ}/doi/pdfdirect/1`, `https://www-sciencedirect-com.${EZ}/science/article/pii/S2`, EZ)).toBeUndefined()
  })
})

describe("an item fetched in a tab", () => {
  const item: WorkItem = { id: "p#1", paperId: "p", attempt: 1, url: `https://${TLINK}/go?url=https://www.tandfonline.com/doi/10.1080/1`, pdfUrl: `https://${TLINK}/go?url=https://www.tandfonline.com/doi/pdf/10.1080/1`, lane: `proxy:${TLINK}`, gate: "pub:tandf", host: TLINK, proxied: true }

  it("on its own page, takes the tab's address and is no longer the proxy's", () => {
    const here = inTabItem(item, "https://www.tandfonline.com/doi/10.1080/1", { html: "<title>T&amp;F</title>" })
    expect(here).toMatchObject({ url: "https://www.tandfonline.com/doi/10.1080/1", pdfUrl: "https://www.tandfonline.com/doi/pdf/10.1080/1", proxied: false })
  })

  it("on its own page without an address from owlit, takes the page's PDF link", () => {
    const html = `<meta name="citation_title" content="A"><meta name="citation_pdf_url" content="https://www.tandfonline.com/doi/pdf/10.1080/1">`
    expect(inTabItem({ ...item, pdfUrl: undefined }, "https://www.tandfonline.com/doi/10.1080/1", { html }).pdfUrl).toBe("https://www.tandfonline.com/doi/pdf/10.1080/1")
  })

  it("in a tab at another of the site's pages, moves only owlit's addresses", () => {
    expect(inTabItem(item, "https://www.tandfonline.com/doi/10.1080/9")).toMatchObject({ url: "https://www.tandfonline.com/doi/10.1080/1", pdfUrl: "https://www.tandfonline.com/doi/pdf/10.1080/1", proxied: false })
  })
})
