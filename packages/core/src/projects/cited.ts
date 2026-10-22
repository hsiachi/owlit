import { isMarkdown, isProjectMark, isWithin, parentPath, projectKey, type CitedPaper, type CitingDoc, type Project, type ProjectCited, type ReadFrom } from "@owlit/protocol"
import { citationKey } from "../docs/citations.ts"
import { citationSpans } from "../library/wear.ts"

// Where the Library's papers are cited, from the docs' text as it is on disk: a paper is in a project by
// reference, cited by a doc under it, never by being filed there. The paper page's "Cited in" asks the
// same texts (docs.citing), so a Library scoped to a project and a paper's page agree on what cites what.

export interface CitedServices {
  projects: () => Promise<Project[]>
  // Every docs file with its mtime (Docs.files)
  files: () => Promise<{ path: string; modifiedAt: number }[]>
  // A file's text on disk; null when it can't be read
  read: (rel: string) => Promise<string | null>
  // The Library's id for a paper named by any id it goes by; undefined when the Library hasn't it
  canonical: (id: string) => Promise<string | undefined>
  // How far Owlit had read behind each citation of a doc it wrote, by citationKey (Citations.owlitDepths)
  owlitDepths: (rel: string) => Promise<Map<string, ReadFrom["depth"]>>
}

// One citation as a doc's text holds it: the link's paper as written, the key what Owlit kept of it is
// found by, where the link starts, and the doc's sentence around it
interface Found {
  paperId: string
  key: string
  from: number
  sentence: string
}

// Deepest first, as protocol ReadFrom's depth says them
const DEPTHS: ReadFrom["depth"][] = ["full", "part", "digest", "abstract", "title"]
const deeper = (a: ReadFrom["depth"] | undefined, b: ReadFrom["depth"]) => (a === undefined || DEPTHS.indexOf(b) < DEPTHS.indexOf(a) ? b : a)

export class Cited {
  private readonly services: CitedServices
  // Each doc's citations, with the mtime they were read at: every ask reads the docs of the whole
  // workspace, and most of them haven't changed since the last
  private readonly docs = new Map<string, { modifiedAt: number; found: Found[] }>()

  constructor(services: CitedServices) {
    this.services = services
  }

  // The papers a marked folder cites; none for a path that is no project
  async ofProject(path: string): Promise<ProjectCited> {
    const projects = await this.services.projects()
    const project = projects.find((p) => projectKey(p.path) === projectKey(path))
    if (!project) return { papers: [] }
    const marked = new Map(projects.map((p) => [p.path, p]))
    const nearest = (rel: string) => {
      for (let p = parentPath(rel); p; p = parentPath(p)) if (marked.has(p)) return marked.get(p)!
      return undefined
    }
    const canonical = this.canonicalOnce()

    const docs = await this.allDocs()
    const papers = new Map<string, { docs: string[]; depth?: ReadFrom["depth"]; also: Map<string, string> }>()
    for (const [rel, found] of docs) {
      if (!found.length || !isWithin(rel, project.path)) continue
      const depths = await this.services.owlitDepths(rel)
      for (const c of found) {
        const id = await canonical(c.paperId)
        if (!id) continue
        const entry = papers.get(id) ?? { docs: [], also: new Map<string, string>() }
        papers.set(id, entry)
        if (!entry.docs.includes(rel)) entry.docs.push(rel)
        const depth = depths.get(c.key)
        if (depth) entry.depth = deeper(entry.depth, depth)
      }
    }
    // A doc of another project says only that the paper is cited there too
    for (const [rel, found] of docs) {
      const home = isWithin(rel, project.path) ? undefined : nearest(rel)
      if (!home) continue
      for (const c of found) {
        const id = await canonical(c.paperId)
        const entry = id ? papers.get(id) : undefined
        if (entry) entry.also.set(home.path, home.name)
      }
    }

    const out: CitedPaper[] = []
    for (const [id, entry] of papers) {
      out.push({
        id,
        docs: [...entry.docs].sort((a, b) => a.localeCompare(b)),
        ...(entry.depth ? { depth: entry.depth } : {}),
        also: [...entry.also].map(([path, name]) => ({ path, name })).sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    return { papers: out }
  }

  // The docs citing a paper under any id it goes by, by path, each with the sentences that cite it
  async citing(paperId: string): Promise<CitingDoc[]> {
    const canonical = this.canonicalOnce()
    const id = (await canonical(paperId)) ?? paperId
    const out: CitingDoc[] = []
    for (const [rel, found] of await this.allDocs()) {
      const sentences: CitingDoc["sentences"] = []
      for (const c of found) if (((await canonical(c.paperId)) ?? c.paperId) === id) sentences.push({ from: c.from, text: c.sentence })
      if (sentences.length) out.push({ path: rel, sentences })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  // Every doc's citations, reading again only the docs whose mtime moved
  private async allDocs(): Promise<[string, Found[]][]> {
    const files = (await this.services.files()).filter((f) => isMarkdown(f.path) && !isProjectMark(f.path))
    const here = new Set(files.map((f) => f.path))
    for (const rel of this.docs.keys()) if (!here.has(rel)) this.docs.delete(rel)
    const out: [string, Found[]][] = []
    for (const file of files) {
      let known = this.docs.get(file.path)
      if (known?.modifiedAt !== file.modifiedAt) {
        const text = await this.services.read(file.path)
        known = { modifiedAt: file.modifiedAt, found: text === null ? [] : foundIn(text) }
        this.docs.set(file.path, known)
      }
      out.push([file.path, known.found])
    }
    return out
  }

  // canonical, asked once per id for one answer: a project cites the same papers from many docs
  private canonicalOnce() {
    const asked = new Map<string, Promise<string | undefined>>()
    return (id: string) => {
      let found = asked.get(id)
      if (!found) asked.set(id, (found = this.services.canonical(id)))
      return found
    }
  }
}

function foundIn(text: string): Found[] {
  const spans = citationSpans(text)
  return spans.map((c) => ({ paperId: c.paperId, key: citationKey(c), from: c.from, sentence: sentenceAround(text, c.from, c.to, spans) }))
}

// A sentence's end: . ! ? followed by a space or the line's end (past any closing bold, quote or bracket),
// or a full-width one
const END = /[.!?](?=[*_"'”’)\]]*(?:\s|$))|[。！？]/g
// Words a period ends without ending the sentence
const ABBREVIATION = /(?:\bet al|\be\.g|\bi\.e|\bcf|\bvs|\betc|\bFig|\bfig|\bEq|\beq|\bSec|\bsec|\bp|\bpp|\bNo|\bno)$/
// A line's own number ("4. ", "**4. "), whose period ends no sentence
const NUMBERING = /^\s*(?:[-*+>]\s+)?(?:\*\*|__)?\d+$/

// The sentence of a doc's text around a citation (from…to), as plain words: within its line, from the end
// of the sentence before to the end of its own. Other citations on the line don't end a sentence, so an
// "et al." in a link's label never cuts one; their labels stand for them.
export function sentenceAround(text: string, from: number, to: number, spans: { from: number; to: number }[] = []): string {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1
  const nextBreak = text.indexOf("\n", to)
  const lineEnd = nextBreak < 0 ? text.length : nextBreak
  const line = text.slice(lineStart, lineEnd)
  // The line with every link blanked, so only the words between links can end a sentence
  let masked = line
  for (const s of spans) {
    if (s.to <= lineStart || s.from >= lineEnd) continue
    const a = Math.max(s.from, lineStart) - lineStart
    const b = Math.min(s.to, lineEnd) - lineStart
    masked = masked.slice(0, a) + " ".repeat(b - a) + masked.slice(b)
  }
  const at = from - lineStart
  const end = to - lineStart
  let start = 0
  let stop = line.length
  for (const m of masked.matchAll(END)) {
    const i = m.index
    if (m[0] === "." && (ABBREVIATION.test(masked.slice(Math.max(0, i - 6), i)) || NUMBERING.test(masked.slice(0, i)))) continue
    if (i < at) start = i + 1
    else if (i >= end) {
      stop = i + 1
      break
    }
  }
  return plain(line.slice(start, stop))
}

// Markdown as the words a reader sees: a link by its label, no emphasis, code or block marks; cut to
// about two lines' worth
const SENTENCE_MAX = 300

function plain(markdown: string): string {
  const words = markdown
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/(\*\*|__|\*|_|`|~~|==)(?=\S)([^]*?\S)\1/g, "$2")
    // Bold the sentence's edge cut in two
    .replace(/\*\*|__/g, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return words.length > SENTENCE_MAX ? `${words.slice(0, SENTENCE_MAX - 1).trimEnd()}…` : words
}
