import { describe, expect, it } from "vitest"
import { idsInUrl, listingOf, namesPdf, paperOfPage } from "./page.ts"

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

// A journal page that describes its article only in schema.org's JSON-LD (abridged, as Nature's and many
// society journals' sites write it)
const jsonLd = `<head><title>Some article</title>
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Journal home"},
  {"@type":"ScholarlyArticle","headline":"Retrieval &amp; Reasoning in Long Contexts","datePublished":"2023-05-02T00:00:00Z",
   "author":[{"@type":"Person","name":"Ana Lima"},{"@type":"Person","name":"Wei Zhang"}],
   "isPartOf":{"@type":"Periodical","name":"Journal of Things"},
   "sameAs":"https://doi.org/10.1234/jot.2023.42"}]}</script>
</head>`

// IEEE Xplore's article page: no citation tags, its metadata in a script in the body (abridged)
const ieee = `<head><meta property="og:title" content="IEEE Xplore"></head>
<script type="text/javascript">
  xplGlobal.document.metadata={"title":"Deep Residual Learning for Image Recognition","authors":[{"name":"Kaiming He"},{"name":"Xiangyu Zhang"}],
  "doi":"10.1109/CVPR.2016.90","publicationTitle":"2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)","publicationYear":"2016",
  "abstract":"Deeper {networks} are \\"harder\\" to train."};
</script>`

// A page with only an og:title, and a DOI it links
const ogTitle = `<head><meta property="og:title" content="A Study of Things">
  <link rel="canonical" href="https://example.org/articles/a-study"></head>
  <p>Cite as <a href="https://doi.org/10.5555/things.2020.7">https://doi.org/10.5555/things.2020.7</a></p>`

describe("paperOfPage, beyond citation tags", () => {
  it("reads a ScholarlyArticle in JSON-LD, anywhere in its graph", () => {
    expect(paperOfPage(jsonLd, "https://example.org/articles/42")).toEqual({
      doi: "10.1234/jot.2023.42",
      title: "Retrieval & Reasoning in Long Contexts",
      authors: ["Ana Lima", "Wei Zhang"],
      year: 2023,
      venue: "Journal of Things",
    })
  })

  it("reads IEEE Xplore's metadata script, and names the PDF itself", () => {
    expect(paperOfPage(ieee, "https://ieeexplore.ieee.org/document/7780459")).toEqual({
      doi: "10.1109/cvpr.2016.90",
      title: "Deep Residual Learning for Image Recognition",
      authors: ["Kaiming He", "Xiangyu Zhang"],
      year: 2016,
      venue: "2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
      pdfUrl: "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=7780459",
    })
  })

  it("takes an og:title as the paper's only beside a DOI the page links", () => {
    expect(paperOfPage(ogTitle, "https://example.org/articles/a-study")).toEqual({ doi: "10.5555/things.2020.7", title: "A Study of Things", authors: [] })
    expect(paperOfPage(`<meta property="og:title" content="Our team">`, "https://example.org/team")).toBeUndefined()
  })

  it("takes no og:title from a news piece about a study, nor from a page citing several DOIs", () => {
    const news = `<head><meta property="og:type" content="article"><meta property="article:section" content="Science">
      <meta property="og:title" content="Scientists find things"></head><a href="https://doi.org/10.5555/things.2020.7">the study</a>`
    expect(paperOfPage(news, "https://news.example.org/science/things")).toBeUndefined()
    const blog = `<head><meta property="og:title" content="What I read"></head>
      <script type="application/ld+json">{"@type":"BlogPosting","citation":"https://doi.org/10.5555/things.2020.7"}</script>`
    expect(paperOfPage(blog, "https://blog.example.org/read")).toBeUndefined()
    const cites = `<head><meta property="og:title" content="Reading list"></head><a href="https://doi.org/10.5555/a.1">a</a><a href="https://doi.org/10.5555/b.2">b</a>`
    expect(paperOfPage(cites, "https://example.org/list")).toBeUndefined()
  })

  it("finds no paper on Google Scholar's results, however many DOIs they link", () => {
    const results = `<head><title>attention - Google Scholar</title></head><a href="https://doi.org/10.1145/3626772.3657891">x</a>`
    expect(paperOfPage(results, "https://scholar.google.com/scholar?q=attention")).toBeUndefined()
    expect(listingOf("https://scholar.google.com.hk/scholar?q=attention")).toBe("Google Scholar")
    expect(listingOf("https://dl.acm.org/doi/10.1145/3626772.3657891")).toBeUndefined()
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

describe("namesPdf", () => {
  it("reads a PDF's address by its path", () => {
    expect(namesPdf("https://arxiv.org/pdf/2403.17859v2")).toBe(true)
    expect(namesPdf("https://example.org/files/paper.pdf?download=1")).toBe(true)
    expect(namesPdf("https://example.org/articles/pdf-tools")).toBe(false)
    expect(namesPdf("not an address")).toBe(false)
  })
})
