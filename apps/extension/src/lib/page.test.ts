import { describe, expect, it } from "vitest"
import { idsInUrl, paperOfPage } from "./page.ts"

// A publisher's article page, as ACM's Digital Library writes its head (abridged)
const publisher = `<head>
  <title>ChroniclingAmericaQA | Proceedings of SIGIR '24</title>
  <meta name="citation_title" content="ChroniclingAmericaQA: A Large-scale Question Answering Dataset">
  <meta name="citation_author" content="Bhawna Piryani">
  <meta name="citation_author" content="Jamshid Mozafari">
  <meta name="citation_publication_date" content="2024/07/10">
  <meta name="citation_conference_title" content="Proceedings of the 47th International ACM SIGIR Conference">
  <meta name="citation_doi" content="10.1145/3626772.3657891">
  <meta name="citation_pdf_url" content="/doi/pdf/10.1145/3626772.3657891?download=true&amp;x=1">
</head>`

// arXiv's abstract page
const arxiv = `<head>
  <meta property="og:title" content="Attention Is All You Need">
  <meta name="citation_title" content="Attention Is All You Need" />
  <meta name="citation_author" content="Vaswani, Ashish" />
  <meta name="citation_date" content="2017/06/12" />
  <meta name="citation_online_date" content="2023/08/02" />
  <meta name="citation_pdf_url" content="https://arxiv.org/pdf/1706.03762" />
  <meta name="citation_arxiv_id" content="1706.03762" />
</head>`

// A page about no paper
const nothing = `<head><title>Weather</title><meta name="description" content="Sunny, 10.5 degrees"></head>`

describe("paperOfPage", () => {
  it("reads a publisher's citation tags, with the PDF's address made whole", () => {
    expect(paperOfPage(publisher, "https://dl.acm.org/doi/10.1145/3626772.3657891")).toEqual({
      doi: "10.1145/3626772.3657891",
      title: "ChroniclingAmericaQA: A Large-scale Question Answering Dataset",
      authors: ["Bhawna Piryani", "Jamshid Mozafari"],
      year: 2024,
      venue: "Proceedings of the 47th International ACM SIGIR Conference",
      pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/3626772.3657891?download=true&x=1",
    })
  })

  it("reads an arXiv abstract page by its arXiv id", () => {
    expect(paperOfPage(arxiv, "https://arxiv.org/abs/1706.03762v7")).toEqual({
      arxiv: "1706.03762",
      title: "Attention Is All You Need",
      authors: ["Vaswani, Ashish"],
      year: 2017,
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
    })
  })

  it("finds no paper on a page that names none", () => {
    expect(paperOfPage(nothing, "https://example.com/weather")).toBeUndefined()
  })

  it("falls back on the DOI or arXiv id in the address", () => {
    expect(paperOfPage(nothing, "https://link.springer.com/article/10.1007/s11192-020-03690-4")).toEqual({ doi: "10.1007/s11192-020-03690-4", authors: [] })
    expect(paperOfPage(nothing, "https://www.tandfonline.com/doi/full/10.1080/01639374.2021.1881009")?.doi).toBe("10.1080/01639374.2021.1881009")
    // arXiv's own DOI in Dublin Core is the arXiv paper
    expect(paperOfPage(`<meta name="DC.identifier" content="https://doi.org/10.48550/arXiv.2403.17859">`, "https://example.org/x")).toMatchObject({ arxiv: "2403.17859" })
  })
})

describe("idsInUrl", () => {
  it("reads arXiv's pages and publishers' DOI addresses", () => {
    expect(idsInUrl("https://arxiv.org/pdf/2403.17859v2")).toEqual({ arxiv: "2403.17859" })
    expect(idsInUrl("https://arxiv.org/abs/hep-th/9901001")).toEqual({ arxiv: "hep-th/9901001" })
    expect(idsInUrl("https://doi.org/10.1145/3626772.3657891")).toEqual({ doi: "10.1145/3626772.3657891" })
    expect(idsInUrl("https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/asi.24750")).toEqual({ doi: "10.1002/asi.24750" })
    expect(idsInUrl("https://example.com/about")).toEqual({})
    expect(idsInUrl("not an address")).toEqual({})
  })
})
