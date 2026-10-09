import { MARK_CLOSE, MARK_OPEN } from "@owlit/protocol"
import type { PaletteResults, SearchHit } from "@owlit/protocol"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

// <workspace data dir>/index.db: SQLite FTS5 over the workspace's papers (metadata and full text),
// docs and chats, and the links between them (owlit:// mentions, [[wikilinks]]). Derived: deleting it
// only means the next sync reads everything again.

// 2: Chinese and Japanese text is split into words (cjkWords)
const SCHEMA_VERSION = 2

export type Source = "paper" | "doc" | "chat"

export interface PaperRow {
  id: string
  title: string
  authors: string
  venue: string
  tags: string
  ids: string
  year: string
  abstract: string
  fulltext: string
}

export interface Link {
  // owlit://library/<id>, owlit://docs/<path>, or wikilink:<name>
  to: string
  kind: "mention" | "wikilink"
}

export class IndexDb {
  readonly file: string
  private db: DatabaseSync

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = path.join(dataDir, "index.db")
    this.db = new DatabaseSync(this.file)
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    if (version !== SCHEMA_VERSION) this.create()
  }

  // Whether this database has never been filled (just created, or deleted and made again)
  get empty() {
    return !(this.db.prepare("SELECT 1 FROM meta LIMIT 1").get() as unknown)
  }

  // What each indexed item looked like on disk when it was indexed (a signature of mtimes)
  signatures(source: Source): Map<string, string> {
    const rows = this.db.prepare("SELECT key, signature FROM meta WHERE source = ?").all(source) as { key: string; signature: string }[]
    return new Map(rows.map((r) => [r.key, r.signature]))
  }

  putPaper(row: PaperRow, links: Link[], signature: string) {
    this.inTransaction(() => {
      this.db.prepare("DELETE FROM papers WHERE id = ?").run(row.id)
      this.db
        .prepare("INSERT INTO papers (id, title, authors, venue, tags, ids, year, abstract, fulltext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, cjkWords(row.title), row.authors, row.venue, row.tags, row.ids, row.year, cjkWords(row.abstract), cjkWords(row.fulltext))
      this.setLinks("paper", row.id, links)
      this.sign("paper", row.id, signature)
    })
  }

  putDoc(docPath: string, title: string, text: string, links: Link[], signature: string) {
    this.inTransaction(() => {
      this.db.prepare("DELETE FROM docs WHERE path = ?").run(docPath)
      this.db.prepare("INSERT INTO docs (path, title, text) VALUES (?, ?, ?)").run(docPath, cjkWords(title), cjkWords(text))
      this.setLinks("doc", docPath, links)
      this.sign("doc", docPath, signature)
    })
  }

  putChat(id: string, title: string, text: string, links: Link[], signature: string) {
    this.inTransaction(() => {
      this.db.prepare("DELETE FROM chats WHERE id = ?").run(id)
      this.db.prepare("INSERT INTO chats (id, title, text) VALUES (?, ?, ?)").run(id, cjkWords(title), cjkWords(text))
      this.setLinks("chat", id, links)
      this.sign("chat", id, signature)
    })
  }

  remove(source: Source, key: string) {
    this.inTransaction(() => {
      const table = source === "paper" ? "papers" : source === "doc" ? "docs" : "chats"
      const column = source === "doc" ? "path" : "id"
      this.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(key)
      this.db.prepare("DELETE FROM links WHERE from_source = ? AND from_key = ?").run(source, key)
      this.db.prepare("DELETE FROM meta WHERE source = ? AND key = ?").run(source, key)
    })
  }

  // Every word must appear (as a word or the start of one). A paper, doc or chat whose title has every
  // word comes first, then by relevance; each group keeps its best `limit`.
  // marked: the matched words in snippets are wrapped in MARK_OPEN and MARK_CLOSE
  palette(query: string, limit = 8, marked = false): PaletteResults {
    const match = toMatch(query)
    if (!match) return { papers: [], docs: [], chats: [] }
    const words = wordsOf(query)
    const [open, close] = marked ? [MARK_OPEN, MARK_CLOSE] : ["", ""]
    const papers = this.db
      .prepare(
        `SELECT id AS key, title, snippet(papers, -1, ?, ?, '…', 14) AS snippet
         FROM papers WHERE papers MATCH ? ORDER BY bm25(papers, 0, 10, 3, 1, 2, 1, 0, 2, 1) LIMIT ?`,
      )
      .all(open, close, match, limit * 4) as unknown as SearchHit[]
    const docs = this.db
      .prepare(`SELECT path AS key, title, snippet(docs, 2, '', '', '…', 14) AS snippet FROM docs WHERE docs MATCH ? ORDER BY bm25(docs, 0, 10, 1) LIMIT ?`)
      .all(match, limit * 4) as unknown as SearchHit[]
    const chats = this.db
      .prepare(`SELECT id AS key, title, snippet(chats, 2, '', '', '…', 14) AS snippet FROM chats WHERE chats MATCH ? ORDER BY bm25(chats, 0, 10, 1) LIMIT ?`)
      .all(match, limit * 4) as unknown as SearchHit[]
    const ranked = (hits: SearchHit[]) =>
      hits
        .map((h) => ({ ...h, title: unsplit(h.title), snippet: unsplit(h.snippet) }))
        .map((h) => ({ ...h, inTitle: words.every((w) => h.title.toLowerCase().includes(w)) }))
        .sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
        .slice(0, limit)
    return { papers: ranked(papers), docs: ranked(docs), chats: ranked(chats) }
  }

  // Papers with every word in their metadata or text, best first
  papers(query: string, limit = 200, marked = false): SearchHit[] {
    return this.palette(query, limit, marked).papers
  }

  // What links to a uri (owlit://library/<id>): docs, chats and paper notes, with their titles
  linksTo(uris: string[]): { source: Source; key: string; title: string }[] {
    if (!uris.length) return []
    const marks = uris.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT DISTINCT l.from_source AS source, l.from_key AS key,
           COALESCE(d.title, c.title, p.title, l.from_key) AS title
         FROM links l
         LEFT JOIN docs d ON l.from_source = 'doc' AND d.path = l.from_key
         LEFT JOIN chats c ON l.from_source = 'chat' AND c.id = l.from_key
         LEFT JOIN papers p ON l.from_source = 'paper' AND p.id = l.from_key
         WHERE l.to_uri IN (${marks})`,
      )
      .all(...uris) as { source: Source; key: string; title: string }[]
    return rows.map((row) => ({ ...row, title: unsplit(row.title) }))
  }

  close() {
    this.db.close()
  }

  private create() {
    this.db.exec(`
      DROP TABLE IF EXISTS papers; DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS chats; DROP TABLE IF EXISTS knowledge;
      DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS meta;
      CREATE VIRTUAL TABLE papers USING fts5(id UNINDEXED, title, authors, venue, tags, ids, year UNINDEXED, abstract, fulltext, tokenize = 'unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, title, text, tokenize = 'unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE chats USING fts5(id UNINDEXED, title, text, tokenize = 'unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE knowledge USING fts5(topic UNINDEXED, line UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
      CREATE TABLE links (from_source TEXT NOT NULL, from_key TEXT NOT NULL, to_uri TEXT NOT NULL, kind TEXT NOT NULL);
      CREATE INDEX links_to ON links (to_uri);
      CREATE INDEX links_from ON links (from_source, from_key);
      CREATE TABLE meta (source TEXT NOT NULL, key TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY (source, key));
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  private setLinks(source: Source, key: string, links: Link[]) {
    this.db.prepare("DELETE FROM links WHERE from_source = ? AND from_key = ?").run(source, key)
    const insert = this.db.prepare("INSERT INTO links (from_source, from_key, to_uri, kind) VALUES (?, ?, ?, ?)")
    for (const link of new Map(links.map((l) => [`${l.kind} ${l.to}`, l])).values()) insert.run(source, key, link.to, link.kind)
  }

  private sign(source: Source, key: string, signature: string) {
    this.db.prepare("INSERT OR REPLACE INTO meta (source, key, signature) VALUES (?, ?, ?)").run(source, key, signature)
  }

  private inTransaction(work: () => void) {
    this.db.exec("BEGIN")
    try {
      work()
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }
}

const wordsOf = (query: string) =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .flatMap((word) => (CJK.test(word) ? cjkWords(word).split(SPLIT) : [word]))

// FTS5's unicode61 tokenizer keeps a run of Chinese or Japanese characters as one token, so a word
// inside a clause (注意力 in 基于注意力机制的模型) can't be found. Such runs are split into words with
// Intl.Segmenter, the same way when indexing and when searching, by an invisible separator that
// unicode61 splits on; what comes back out has it taken away again.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu
const SPLIT = "\u200b"
const segmenter = new Intl.Segmenter("zh", { granularity: "word" })

function cjkWords(text: string) {
  if (!CJK.test(text)) return text
  return text.replace(CJK_RUN, (run) => [...segmenter.segment(run)].map((s) => s.segment).join(SPLIT))
}

const unsplit = (text: string) => text.replaceAll(SPLIT, "")

// "attention transform" → "attention"* AND "transform"*
export function toMatch(query: string) {
  const words = wordsOf(query)
  return words.length ? words.map((w) => `"${w}"*`).join(" AND ") : ""
}

// owlit:// mentions and [[wikilinks]] in a text
export function linksIn(text: string): Link[] {
  const links: Link[] = []
  for (const m of text.matchAll(/owlit:\/\/(library|docs|knowledge)\/([^\s)"'#\]>]+)/g)) {
    links.push({ to: `owlit://${m[1]}/${decodeOrKeep(m[2])}`, kind: "mention" })
  }
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) links.push({ to: `wikilink:${m[1].trim()}`, kind: "wikilink" })
  return links
}

// A stray % in someone's text ("report-100%") is kept as written rather than failing the index
function decodeOrKeep(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
