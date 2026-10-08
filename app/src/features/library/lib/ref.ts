const ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/
const DOI = /(10\.\d{4,9}\/[^\s"<>]+)/i

// Recognise what the user pasted. Order matters: an arXiv URL also contains digits a DOI
// pattern would not match, but a doi.org URL must not be read as a plain URL.
export function parseRef(input: string): { arxiv?: string; doi?: string; url?: string } {
  const s = input.trim()
  if (/arxiv\.org/i.test(s) || /^arxiv:/i.test(s) || ARXIV_ID.test(s) && !/^https?:/i.test(s) && !DOI.test(s)) {
    const m = s.match(ARXIV_ID)
    if (m) return { arxiv: m[1] }
  }
  const d = s.match(DOI)
  if (d) return { doi: d[1].replace(/[.,;)]+$/, "") }
  if (/^https?:\/\//i.test(s)) return { url: s }
  return {}
}

// Whether the find field holds a reference to add rather than words to search for
export function looksLikeRef(input: string): boolean {
  const s = input.trim()
  if (!s || /\s/.test(s)) return false
  const r = parseRef(s)
  return !!(r.arxiv || r.doi || r.url)
}
