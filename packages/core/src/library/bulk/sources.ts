import { t } from "@lingui/core/macro"
import type { PaperIds } from "@owlit/protocol"
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { parseRef, stripArxivVersion } from "../refs.ts"

// The papers an existing collection holds, read as a flat list for a bulk import: a Zotero library
// (its zotero.sqlite, or a Better BibTeX JSON export), a .bib file, or a folder of PDFs. Every source
// is only read.

export type ImportSource = "zotero" | "bibtex" | "folder"

// One paper from a collection, as the collection describes it
export interface ImportEntry {
  // Stable within the source across re-reads (Zotero item key, BibTeX citation key, a PDF's path relative to the folder), so an interrupted import can skip what it did
  key: string
  title?: string
  // "First Last" each
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  // doi lowercased without https://doi.org/ ; arxiv without version (2408.00447, hep-th/9901001); url only when there is no doi/arxiv
  ids: PaperIds
  // Absolute path of a local PDF that exists on disk
  pdf?: string
  // Zotero collection names, only when collectionsAsTags
  tags?: string[]
}

// path: for zotero, the zotero.sqlite file, the Zotero data folder holding it, or a Better BibTeX JSON export (.json); for bibtex a .bib file; for folder a directory
export async function readSource(source: ImportSource, input: string, options: { collectionsAsTags?: boolean } = {}): Promise<ImportEntry[]> {
  const where = path.resolve(input)
  const tags = options.collectionsAsTags ?? false
  const entries =
    source === "zotero" ? await (/\.json$/i.test(where) ? readBetterBibtex(where, tags) : readZotero(where, tags)) : source === "bibtex" ? await readBibtex(where) : await readFolder(where)
  return uniqueKeys(entries)
}

// An import keeps what it did by key, so two entries under one key (a .bib merged from two, with smith2020
// in both) would make it skip the second: the second and later get #2, #3, the same on every read
function uniqueKeys(entries: ImportEntry[]): ImportEntry[] {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const n = (seen.get(entry.key) ?? 0) + 1
    seen.set(entry.key, n)
    return n === 1 ? entry : { ...entry, key: `${entry.key}#${n}` }
  })
}

// ---- Shared: Zotero's fields, as both zotero.sqlite and Better BibTeX's JSON name them

interface ZoteroFields {
  title?: string
  DOI?: string
  url?: string
  date?: string
  publicationTitle?: string
  proceedingsTitle?: string
  bookTitle?: string
  conferenceName?: string
  abstractNote?: string
  archiveID?: string
  extra?: string
}

const ZOTERO_FIELDS = ["title", "DOI", "url", "date", "publicationTitle", "proceedingsTitle", "bookTitle", "conferenceName", "abstractNote", "archiveID", "extra"] as const

// Item types that are not papers: their content hangs off a paper, or is the paper's file
const NOT_PAPERS = new Set(["note", "annotation", "attachment"])

interface Creator {
  firstName?: string
  lastName?: string
  name?: string
  fieldMode?: number
  creatorType?: string
}

function zoteroEntry(key: string, fields: ZoteroFields, creators: Creator[], pdf: string | undefined, tags: string[] | undefined): ImportEntry {
  return clean({
    key,
    title: text(fields.title),
    authors: authorsOf(creators),
    year: yearOf(fields.date),
    venue: text(fields.publicationTitle) ?? text(fields.proceedingsTitle) ?? text(fields.bookTitle) ?? text(fields.conferenceName),
    abstract: text(fields.abstractNote),
    // An arXiv paper's id lives in archiveID ("arXiv:2408.00447"), in Extra ("arXiv: 2408.00447 [cs]"), or only in its URL
    ids: idsOf([fields.DOI, fields.archiveID, ...extraIds(fields.extra)], fields.url),
    pdf,
    tags,
  })
}

// Authors only; editors and translators count when a record names nobody else
function authorsOf(creators: Creator[]): string[] {
  const authors = creators.filter((c) => (c.creatorType ?? "author") === "author")
  return (authors.length ? authors : creators)
    .map((c) => (c.name ?? (c.fieldMode === 1 ? c.lastName : [c.firstName, c.lastName].filter(Boolean).join(" ")) ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

// Extra's "arXiv: …" and "DOI: …" lines, cut to the id: the rest of the line ("[cs.HC]") would hide it
function extraIds(extra: string | undefined): string[] {
  const ids: string[] = []
  for (const line of extra?.split(/\r?\n/) ?? []) {
    const match = line.trim().match(/^(arxiv|doi)\s*:\s*(\S+)/i)
    if (match) ids.push(`${match[1]}:${match[2]}`)
  }
  return ids
}

// ---- Zotero's own database

async function readZotero(input: string, collectionsAsTags: boolean): Promise<ImportEntry[]> {
  const file = await zoteroDatabase(input)
  // Zotero keeps its database locked while it runs, and must never see a write from us: read a copy
  const temp = await mkdtemp(path.join(tmpdir(), "owlit-zotero-"))
  try {
    const copy = path.join(temp, "zotero.sqlite")
    await copyFile(file, copy)
    const { DatabaseSync } = await import("node:sqlite")
    let db: DatabaseSync | undefined
    let rows: ZoteroRows
    try {
      db = new DatabaseSync(copy, { readOnly: true })
      rows = zoteroRows(db, collectionsAsTags)
    } catch {
      throw new Error(t`There is no Zotero library at ${input}.`)
    } finally {
      db?.close()
    }
    return await zoteroEntries(rows, path.dirname(file))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function zoteroDatabase(input: string): Promise<string> {
  const info = await stat(input).catch(() => undefined)
  const file = info?.isDirectory() ? path.join(input, "zotero.sqlite") : input
  if (!(await isFile(file))) throw new Error(t`There is no Zotero library at ${input}.`)
  return file
}

interface ItemRow {
  id: number
  key: string
  type: string
}
interface FieldRow {
  id: number
  name: (typeof ZOTERO_FIELDS)[number]
  value: string | number | null
}
interface CreatorRow {
  id: number
  firstName: string | null
  lastName: string | null
  fieldMode: number | null
  creatorType: string
}
interface AttachmentRow {
  id: number
  parent: number | null
  linkMode: number | null
  contentType: string | null
  path: string | null
}
interface CollectionRow {
  id: number
  name: string
}

interface ZoteroRows {
  items: ItemRow[]
  fields: FieldRow[]
  creators: CreatorRow[]
  attachments: AttachmentRow[]
  collections?: CollectionRow[]
}

function zoteroRows(db: DatabaseSync, collectionsAsTags: boolean): ZoteroRows {
  const all = <T>(sql: string, ...params: string[]) => db.prepare(sql).all(...params) as unknown as T[]
  const hasTable = (name: string) => all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, name).length > 0
  // Feeds are libraries too, of items the user never kept; the trash holds what they threw away
  const items = all<ItemRow>(`
    SELECT i.itemID AS id, i.key AS key, t.typeName AS type
    FROM items i
    JOIN itemTypes t ON t.itemTypeID = i.itemTypeID
    JOIN libraries l ON l.libraryID = i.libraryID
    WHERE l.type != 'feed' AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
    ORDER BY i.itemID`)
  const fields = all<FieldRow>(
    `
    SELECT d.itemID AS id, f.fieldName AS name, v.value AS value
    FROM itemData d
    JOIN fields f ON f.fieldID = d.fieldID
    JOIN itemDataValues v ON v.valueID = d.valueID
    WHERE f.fieldName IN (${ZOTERO_FIELDS.map(() => "?").join(", ")})`,
    ...ZOTERO_FIELDS,
  )
  const creators = all<CreatorRow>(`
    SELECT ic.itemID AS id, c.firstName AS firstName, c.lastName AS lastName, c.fieldMode AS fieldMode, ct.creatorType AS creatorType
    FROM itemCreators ic
    JOIN creators c ON c.creatorID = ic.creatorID
    JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
    ORDER BY ic.itemID, ic.orderIndex`)
  const attachments = all<AttachmentRow>(`
    SELECT itemID AS id, parentItemID AS parent, linkMode, contentType, path
    FROM itemAttachments
    ORDER BY itemID`)
  if (!collectionsAsTags) return { items, fields, creators, attachments }
  // Zotero 7 keeps a trash for collections too
  const deleted = hasTable("deletedCollections") ? "WHERE c.collectionID NOT IN (SELECT collectionID FROM deletedCollections)" : ""
  const collections = all<CollectionRow>(`
    SELECT ci.itemID AS id, c.collectionName AS name
    FROM collectionItems ci
    JOIN collections c ON c.collectionID = ci.collectionID
    ${deleted}
    ORDER BY ci.itemID, c.collectionName`)
  return { items, fields, creators, attachments, collections }
}

async function zoteroEntries(rows: ZoteroRows, dataDir: string): Promise<ImportEntry[]> {
  const fields = groupBy(rows.fields)
  const creators = groupBy(rows.creators)
  const collections = rows.collections && groupBy(rows.collections)
  const keys = new Map(rows.items.map((item) => [item.id, item.key]))
  const attachments = new Map(rows.attachments.map((a) => [a.id, a]))
  // An attachment in the trash doesn't count, though its paper isn't
  const children = new Map<number, AttachmentRow[]>()
  for (const a of rows.attachments) if (a.parent !== null && keys.has(a.id)) children.set(a.parent, [...(children.get(a.parent) ?? []), a])

  const fieldsOf = (id: number): ZoteroFields => Object.fromEntries((fields.get(id) ?? []).map((f) => [f.name, f.value === null ? undefined : String(f.value)]))
  const tagsOf = (id: number) => tagList((collections?.get(id) ?? []).map((c) => c.name))
  const pdfOf = async (attachment: AttachmentRow) => {
    const file = attachmentPath(attachment, keys.get(attachment.id)!, dataDir)
    return file && (await isFile(file)) ? file : undefined
  }

  const entries: ImportEntry[] = []
  for (const item of rows.items) {
    if (item.type === "attachment") {
      // A PDF dropped into Zotero on its own is a paper Zotero never identified
      const attachment = attachments.get(item.id)
      if (!attachment || attachment.parent !== null) continue
      const pdf = await pdfOf(attachment)
      if (pdf) entries.push(clean({ key: item.key, title: text(fieldsOf(item.id).title), authors: [], ids: {}, pdf, tags: tagsOf(item.id) }))
      continue
    }
    if (NOT_PAPERS.has(item.type)) continue
    let pdf: string | undefined
    for (const attachment of children.get(item.id) ?? []) {
      pdf = await pdfOf(attachment)
      if (pdf) break
    }
    const people = (creators.get(item.id) ?? []).map((c) => ({ firstName: c.firstName ?? undefined, lastName: c.lastName ?? undefined, fieldMode: c.fieldMode ?? undefined, creatorType: c.creatorType }))
    entries.push(zoteroEntry(item.key, fieldsOf(item.id), people, pdf, tagsOf(item.id)))
  }
  return entries
}

// Where an attachment's PDF lies: a stored file (linkMode 0, 1) in storage/<its key>/, or a linked
// file (2) at an absolute path. A linked file relative to Zotero's base directory ("attachments:…")
// can't be found: the base directory is in Zotero's prefs, not its database.
function attachmentPath(attachment: AttachmentRow, key: string, dataDir: string): string | undefined {
  const stored = attachment.path ?? ""
  if (attachment.contentType !== "application/pdf" && !/\.pdf$/i.test(stored)) return undefined
  if ((attachment.linkMode === 0 || attachment.linkMode === 1) && stored.startsWith("storage:")) return path.join(dataDir, "storage", key, stored.slice("storage:".length))
  if (attachment.linkMode === 2 && path.isAbsolute(stored)) return stored
  return undefined
}

// ---- Better BibTeX's JSON export

interface BetterBibtexItem extends ZoteroFields {
  itemType?: string
  itemID?: number
  key?: string
  itemKey?: string
  citationKey?: string
  citekey?: string
  creators?: Creator[]
  attachments?: { path?: string; title?: string }[]
  collections?: string[]
  deleted?: boolean
  path?: string
}

interface BetterBibtexExport {
  items?: BetterBibtexItem[]
  collections?: Record<string, { key?: string; name?: string; items?: (number | string)[] }>
}

async function readBetterBibtex(file: string, collectionsAsTags: boolean): Promise<ImportEntry[]> {
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(t`There is no file at ${file}.`)
  })
  let data: BetterBibtexExport
  try {
    data = JSON.parse(raw) as BetterBibtexExport
  } catch {
    data = {}
  }
  if (!data || !Array.isArray(data.items)) throw new Error(t`${file} isn't a Better BibTeX JSON export.`)

  // The export lists each collection's members by item id or key; items may also name their collections' keys
  const collections = Object.entries(data.collections ?? {}).map(([key, c]) => ({ key: c.key ?? key, name: c.name ?? "", members: new Set((c.items ?? []).map(String)) }))
  const tagsOf = (item: BetterBibtexItem) => {
    if (!collectionsAsTags) return undefined
    const names = collections
      .filter((c) => c.name && (item.collections?.includes(c.key) || c.members.has(String(item.itemID)) || (item.key !== undefined && c.members.has(item.key))))
      .map((c) => c.name)
    return tagList(names)
  }

  const entries: ImportEntry[] = []
  for (const [index, item] of data.items.entries()) {
    if (!item || typeof item !== "object" || item.deleted) continue
    const key = item.key ?? item.itemKey ?? item.citationKey ?? item.citekey ?? `entry-${index + 1}`
    if (item.itemType === "attachment") {
      const pdf = await existingPdf(item.path)
      if (pdf) entries.push(clean({ key, title: text(item.title), authors: [], ids: {}, pdf, tags: tagsOf(item) }))
      continue
    }
    if (NOT_PAPERS.has(item.itemType ?? "")) continue
    let pdf: string | undefined
    for (const attachment of item.attachments ?? []) {
      pdf = await existingPdf(attachment?.path)
      if (pdf) break
    }
    entries.push(zoteroEntry(key, item, Array.isArray(item.creators) ? item.creators : [], pdf, tagsOf(item)))
  }
  return entries
}

async function existingPdf(file: string | undefined): Promise<string | undefined> {
  if (typeof file !== "string" || !path.isAbsolute(file) || !/\.pdf$/i.test(file)) return undefined
  return (await isFile(file)) ? file : undefined
}

// ---- BibTeX

async function readBibtex(file: string): Promise<ImportEntry[]> {
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) throw new Error(t`There is no file at ${file}.`)
  const source = await readFile(file, "utf8")
  const parsed = parseBibtex(source)
  if (!parsed.length && (source.trim() || !/\.bib$/i.test(file))) throw new Error(t`${file} isn't a BibTeX file.`)

  // An entry others point at with crossref is the proceedings or book they appeared in, not a paper
  const byKey = new Map(parsed.filter((e) => e.key).map((e) => [e.key!.toLowerCase(), e]))
  const containers = new Set(parsed.map((e) => e.fields.get("crossref")?.trim().toLowerCase()).filter((k): k is string => !!k && byKey.has(k)))

  const entries: ImportEntry[] = []
  for (const [index, entry] of parsed.entries()) {
    if (entry.key && containers.has(entry.key.toLowerCase())) continue
    const field = (name: string) => entry.fields.get(name)
    const parent = byKey.get(field("crossref")?.trim().toLowerCase() ?? "")
    const venue = field("journal") ?? field("journaltitle") ?? field("booktitle") ?? parent?.fields.get("booktitle") ?? parent?.fields.get("title")
    // An eprint is an arXiv id unless archivePrefix names another archive
    const archive = (field("archiveprefix") ?? field("eprinttype"))?.trim().toLowerCase()
    const eprint = field("eprint") && (!archive || archive === "arxiv") ? `arXiv:${bare(field("eprint")!)}` : undefined
    const arxivId = field("arxivid") ?? field("arxiv")
    entries.push(
      clean({
        key: entry.key || `entry-${index + 1}`,
        title: text(latexToText(field("title") ?? "")),
        authors: bibNames(field("author") ?? field("editor") ?? ""),
        year: yearOf(field("year") ?? field("date")),
        venue: text(latexToText(venue ?? "")),
        abstract: text(latexToText(field("abstract") ?? "")),
        ids: idsOf([field("doi") && bare(field("doi")!), eprint, arxivId && `arXiv:${bare(arxivId)}`], field("url") && bare(field("url")!)),
      }),
    )
  }
  return entries
}

interface BibEntry {
  type: string
  key?: string
  fields: Map<string, string>
}

const MONTHS: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
}

// Entries with their fields' values as written (braces inside a value kept, macros expanded, #
// joined). Tolerant: an entry that doesn't parse is skipped and reading goes on at the next "@".
function parseBibtex(src: string): BibEntry[] {
  const macros = new Map(Object.entries(MONTHS))
  const entries: BibEntry[] = []
  let i = 0

  const read = (re: RegExp) => {
    re.lastIndex = i
    const match = re.exec(src)
    if (match) i = re.lastIndex
    return match?.[0]
  }
  const space = () => read(/\s*/y)
  // The index just past the brace that closes the one at `open`
  const pastGroup = (open: number) => {
    let depth = 0
    for (let j = open; j < src.length; j++) {
      const c = src[j]
      if (c === "\\") j++
      else if (c === "{") depth++
      else if (c === "}" && --depth === 0) return j + 1
    }
    throw new Error("unbalanced braces")
  }
  const value = (close: string) => {
    let out = ""
    for (;;) {
      space()
      const c = src[i]
      if (c === "{") {
        const end = pastGroup(i)
        out += src.slice(i + 1, end - 1)
        i = end
      } else if (c === '"') {
        // A quote inside braces doesn't end the value
        let depth = 0
        let j = i + 1
        for (; j < src.length; j++) {
          const d = src[j]
          if (d === "\\") j++
          else if (d === "{") depth++
          else if (d === "}") depth--
          else if (d === '"' && depth === 0) break
        }
        if (j >= src.length) throw new Error("unterminated quote")
        out += src.slice(i + 1, j)
        i = j + 1
      } else {
        const token = read(/[^\s,#{}"()=]+/y)
        if (!token) throw new Error(`no value before ${close}`)
        out += /^\d+$/.test(token) ? token : (macros.get(token.toLowerCase()) ?? token)
      }
      space()
      if (src[i] !== "#") return out
      i++
    }
  }
  const fields = (close: string) => {
    const found = new Map<string, string>()
    for (;;) {
      space()
      if (src[i] === ",") {
        i++
        continue
      }
      if (src[i] === close) {
        i++
        return found
      }
      const name = read(/[^\s=,{}()"#]+/y)
      space()
      if (!name || src[i] !== "=") throw new Error("expected a field")
      i++
      const v = value(close)
      if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), v)
    }
  }

  for (;;) {
    const at = src.indexOf("@", i)
    if (at < 0) return entries
    i = at + 1
    const type = read(/[A-Za-z]+/y)?.toLowerCase()
    space()
    const open = src[i]
    if (!type || (open !== "{" && open !== "(")) continue
    const close = open === "{" ? "}" : ")"
    try {
      if (type === "comment" || type === "preamble") {
        i = open === "{" ? pastGroup(i) : Math.max(src.indexOf(")", i) + 1, i + 1)
        continue
      }
      i++
      if (type === "string") {
        for (const [name, v] of fields(close)) macros.set(name, v)
        continue
      }
      space()
      const keyStart = i
      let key = read(/[^\s,{}()="#]+/y)
      space()
      // No key: what was read is the first field's name
      if (src[i] === "=") {
        i = keyStart
        key = undefined
      }
      const found = fields(close)
      if (type !== "set" && type !== "xdata") entries.push({ type, key, fields: found })
    } catch {
      i = at + 1
    }
  }
}

// "A and B and others", each "Last, First", "Last, Jr, First" or "First Last"; a name in braces
// ("{World Health Organization}") is one name
function bibNames(raw: string): string[] {
  return splitTop(raw, /\s+and\s+/iy)
    .map((name) => {
      const parts = splitTop(name.trim(), /\s*,\s*/y)
      const ordered = parts.length === 2 ? [parts[1], parts[0]] : parts.length >= 3 ? [parts[2], parts[0], parts[1]] : parts
      return latexToText(ordered.filter(Boolean).join(" "))
    })
    .filter((name) => name && name.toLowerCase() !== "others")
}

// Splits where `separator` (sticky) matches outside braces
function splitTop(raw: string, separator: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (depth === 0) {
      separator.lastIndex = i
      const match = separator.exec(raw)
      if (match && match[0].length) {
        parts.push(raw.slice(start, i))
        start = i + match[0].length
        i = start - 1
      }
    }
  }
  parts.push(raw.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

// The combining mark each accent command puts on its letter
const ACCENTS: Record<string, string> = {
  '"': "̈",
  "'": "́",
  "`": "̀",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  c: "̧",
  v: "̌",
  u: "̆",
  H: "̋",
  k: "̨",
  r: "̊",
  d: "̣",
}
// \i and \j are the dotless letters an accent sits on: as plain letters they compose with it
const LETTERS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "i", j: "j" }
const SYMBOLS: Record<string, string> = {
  textendash: "–",
  textemdash: "—",
  ldots: "…",
  dots: "…",
  textquoteright: "’",
  textquoteleft: "‘",
  textregistered: "®",
  texttrademark: "™",
  copyright: "©",
  LaTeX: "LaTeX",
  TeX: "TeX",
}
const FORMATTING = /\\(?:emph|textit|textbf|textsc|texttt|textrm|textsf|textsl|textup|textnormal|text|mathrm|mathbf|mathit|mathsf|mathcal|mbox|hbox|url|bm|it|bf|em|sc|tt|rm|sf|sl)(?![A-Za-z])\s*/g
// Escaped characters stay out of the way of brace and $ removal in a private-use stand-in
const ESCAPED = "&%$#_{}"
const HOLD = 0xe000

// A field's LaTeX as plain text: accents to Unicode, protective braces and formatting commands
// gone, dashes and ties as typed text
function latexToText(raw: string): string {
  return raw
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*/g, (_, w: string) => LETTERS[w])
    .replace(/\\(["'`^~=.])\s*(?:\{\s*([A-Za-z])\s*\}|([A-Za-z]))/g, (_, a: string, x?: string, y?: string) => (x ?? y)! + ACCENTS[a])
    .replace(/\\([cvuHkrd])(?:\s*\{\s*([A-Za-z])\s*\}|\s+([A-Za-z]))/g, (_, a: string, x?: string, y?: string) => (x ?? y)! + ACCENTS[a])
    .replace(/\\([&%$#_{}])/g, (_, c: string) => String.fromCharCode(HOLD + ESCAPED.indexOf(c)))
    .replace(FORMATTING, "")
    .replace(/\\([A-Za-z]+)\s*/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/\\[,;: ]/g, " ")
    .replace(/\\\\/g, " ")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    // A tie is a space that doesn't break a line; as plain text an ordinary space matches better
    .replace(/~/g, " ")
    .replace(/[{}$]/g, "")
    .replace(/[-]/g, (c) => ESCAPED[c.charCodeAt(0) - HOLD])
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC")
}

// An id or URL field: braces and escapes off, nothing else touched ("--" stays in a URL)
function bare(raw: string): string {
  return raw
    .replace(/^\s*\\url\s*/, "")
    .replace(/\\([&%$#_~])/g, "$1")
    .replace(/[{}]/g, "")
    .trim()
}

// ---- A folder of PDFs

async function readFolder(dir: string): Promise<ImportEntry[]> {
  const info = await stat(dir).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(t`There is no folder at ${dir}.`)
  const entries: ImportEntry[] = []
  const walk = async (rel: string) => {
    const names = await readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])
    for (const dirent of names.sort((a, b) => a.name.localeCompare(b.name))) {
      // Dot-folders are an app's own (.git, .Trash); a linked folder could lead back up the tree
      if (dirent.name.startsWith(".")) continue
      const child = rel ? `${rel}/${dirent.name}` : dirent.name
      const full = path.join(dir, child)
      if (dirent.isDirectory()) await walk(child)
      else if (/\.pdf$/i.test(dirent.name) && (dirent.isFile() || (dirent.isSymbolicLink() && (await isFile(full))))) entries.push({ key: child, authors: [], ids: {}, pdf: full })
    }
  }
  await walk("")
  return entries
}

// ---- Helpers

// The first DOI and the first arXiv id among the candidates, then what the URL adds; the URL itself
// only when it named neither
function idsOf(candidates: (string | undefined)[], url: string | undefined): PaperIds {
  const ids: PaperIds = {}
  for (const candidate of [...candidates, url]) {
    const ref = candidate?.trim() ? parseRef(candidate) : undefined
    if (ref?.kind === "doi") ids.doi ??= ref.value
    else if (ref?.kind === "arxiv") ids.arxiv ??= stripArxivVersion(ref.value)
  }
  const link = url?.trim()
  if (!ids.doi && !ids.arxiv && link && /^https?:\/\//i.test(link)) ids.url = link
  return ids
}

function yearOf(date: string | undefined): number | undefined {
  const year = Number(date?.match(/(?<!\d)\d{4}(?!\d)/)?.[0])
  return year > 0 ? year : undefined
}

function text(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
  return trimmed || undefined
}

function groupBy<T extends { id: number }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const row of rows) {
    const group = groups.get(row.id)
    if (group) group.push(row)
    else groups.set(row.id, [row])
  }
  return groups
}

// Each name once; none at all is no tags
function tagList(names: string[]): string[] | undefined {
  return names.length ? [...new Set(names)] : undefined
}

async function isFile(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined))?.isFile() ?? false
}

// Without the fields nobody filled
function clean(entry: ImportEntry): ImportEntry {
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as unknown as ImportEntry
}
