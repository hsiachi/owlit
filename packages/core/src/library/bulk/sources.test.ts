import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { readSource } from "./sources.ts"

const PDF = "%PDF-1.4\n%%EOF\n"

function scratch(name: string) {
  return realpathSync(mkdtempSync(path.join(tmpdir(), `owlit-bulk-${name}-`)))
}

function put(file: string, body = PDF) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body)
  return file
}

// The tables a bulk import reads, as Zotero 7 declares them (without its indexes and triggers)
const ZOTERO_SCHEMA = `
  CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT NOT NULL, editable INT NOT NULL, filesEditable INT NOT NULL, version INT NOT NULL DEFAULT 0, storageVersion INT NOT NULL DEFAULT 0, lastSync INT NOT NULL DEFAULT 0, archived INT NOT NULL DEFAULT 0);
  CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT, templateItemTypeID INT, display INT DEFAULT 1);
  CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT NOT NULL, dateAdded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, dateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, libraryID INT NOT NULL, key TEXT NOT NULL, version INT NOT NULL DEFAULT 0, synced INT NOT NULL DEFAULT 0, UNIQUE (libraryID, key));
  CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT, fieldFormatID INT);
  CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value UNIQUE);
  CREATE TABLE itemData (itemID INT, fieldID INT, valueID, PRIMARY KEY (itemID, fieldID));
  CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT, UNIQUE (lastName, firstName, fieldMode));
  CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
  CREATE TABLE itemCreators (itemID INT NOT NULL, creatorID INT NOT NULL, creatorTypeID INT NOT NULL DEFAULT 1, orderIndex INT NOT NULL DEFAULT 0, PRIMARY KEY (itemID, creatorID, creatorTypeID, orderIndex), UNIQUE (itemID, orderIndex));
  CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT, charsetID INT, path TEXT, syncState INT DEFAULT 0, storageModTime INT, storageHash TEXT, lastProcessedModificationTime INT, lastRead INT);
  CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY, dateDeleted DEFAULT CURRENT_TIMESTAMP NOT NULL);
  CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT NOT NULL, parentCollectionID INT DEFAULT NULL, clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, libraryID INT NOT NULL, key TEXT NOT NULL, version INT NOT NULL DEFAULT 0, synced INT NOT NULL DEFAULT 0, UNIQUE (libraryID, key));
  CREATE TABLE collectionItems (collectionID INT NOT NULL, itemID INT NOT NULL, orderIndex INT NOT NULL DEFAULT 0, PRIMARY KEY (collectionID, itemID));
  CREATE TABLE deletedCollections (collectionID INTEGER PRIMARY KEY, dateDeleted DEFAULT CURRENT_TIMESTAMP NOT NULL);
`

interface ZoteroItem {
  type: string
  key: string
  library?: number
  fields?: Record<string, string>
  creators?: { first?: string; last: string; single?: boolean; role?: string }[]
  attachment?: { parent?: number; linkMode: number; contentType?: string; path: string }
  deleted?: boolean
}

// A Zotero data folder: zotero.sqlite holding `items` (itemID = position + 1) and its storage/
function zoteroLibrary(dataDir: string, items: ZoteroItem[], collections: { name: string; items: number[]; deleted?: boolean }[]) {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, "zotero.sqlite"))
  db.exec(ZOTERO_SCHEMA)
  db.exec(`INSERT INTO libraries (libraryID, type, editable, filesEditable) VALUES (1, 'user', 1, 1), (2, 'feed', 0, 0)`)
  const ids = new Map<string, number>()
  const idOf = (table: string, column: string, value: string) => {
    const name = `${table}:${value}`
    if (!ids.has(name)) {
      ids.set(name, ids.size + 1)
      db.prepare(`INSERT INTO ${table} (${table === "itemTypes" ? "itemTypeID" : table === "fields" ? "fieldID" : table === "creatorTypes" ? "creatorTypeID" : "valueID"}, ${column}) VALUES (?, ?)`).run(ids.get(name)!, value)
    }
    return ids.get(name)!
  }
  let creatorId = 0
  for (const [index, item] of items.entries()) {
    const itemID = index + 1
    db.prepare(`INSERT INTO items (itemID, itemTypeID, libraryID, key) VALUES (?, ?, ?, ?)`).run(itemID, idOf("itemTypes", "typeName", item.type), item.library ?? 1, item.key)
    for (const [field, value] of Object.entries(item.fields ?? {})) {
      db.prepare(`INSERT INTO itemData (itemID, fieldID, valueID) VALUES (?, ?, ?)`).run(itemID, idOf("fields", "fieldName", field), idOf("itemDataValues", "value", value))
    }
    for (const [order, c] of (item.creators ?? []).entries()) {
      creatorId++
      db.prepare(`INSERT INTO creators (creatorID, firstName, lastName, fieldMode) VALUES (?, ?, ?, ?)`).run(creatorId, c.single ? "" : (c.first ?? ""), c.last, c.single ? 1 : 0)
      db.prepare(`INSERT INTO itemCreators (itemID, creatorID, creatorTypeID, orderIndex) VALUES (?, ?, ?, ?)`).run(itemID, creatorId, idOf("creatorTypes", "creatorType", c.role ?? "author"), order)
    }
    if (item.attachment) {
      const a = item.attachment
      db.prepare(`INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path) VALUES (?, ?, ?, ?, ?)`).run(itemID, a.parent ?? null, a.linkMode, a.contentType ?? "application/pdf", a.path)
    }
    if (item.deleted) db.prepare(`INSERT INTO deletedItems (itemID) VALUES (?)`).run(itemID)
  }
  for (const [index, c] of collections.entries()) {
    db.prepare(`INSERT INTO collections (collectionID, collectionName, libraryID, key) VALUES (?, ?, 1, ?)`).run(index + 1, c.name, `COLL000${index + 1}`)
    for (const item of c.items) db.prepare(`INSERT INTO collectionItems (collectionID, itemID) VALUES (?, ?)`).run(index + 1, item)
    if (c.deleted) db.prepare(`INSERT INTO deletedCollections (collectionID) VALUES (?)`).run(index + 1)
  }
  db.close()
}

function zoteroFixture() {
  const base = scratch("zotero")
  const dataDir = path.join(base, "Zotero")
  const linked = put(path.join(base, "elsewhere", "Linked Paper.pdf"))
  put(path.join(dataDir, "storage", "STOR0003", "Vaswani et al. - 2017.pdf"))
  put(path.join(dataDir, "storage", "SOLO0011", "loose.pdf"))
  zoteroLibrary(
    dataDir,
    [
      /* 1 */ {
        type: "journalArticle",
        key: "JRNL0001",
        fields: { title: "A Journal  Article", DOI: "https://doi.org/10.1000/XYZ.1", date: "2020-03-01 March 1, 2020", publicationTitle: "Journal of Tests", abstractNote: "What it found." },
        creators: [
          { first: "Ada", last: "Lovelace" },
          { last: "World Health Organization", single: true },
          { first: "Ed", last: "Itor", role: "editor" },
        ],
      },
      // A linked file that is gone comes first; the stored copy after it is the one that counts
      /* 2 */ { type: "attachment", key: "GONE0002", attachment: { parent: 1, linkMode: 2, path: path.join(base, "missing", "gone.pdf") } },
      /* 3 */ { type: "attachment", key: "STOR0003", attachment: { parent: 1, linkMode: 1, path: "storage:Vaswani et al. - 2017.pdf" } },
      /* 4 */ {
        type: "preprint",
        key: "PREP0004",
        fields: { title: "A Preprint", archiveID: "arXiv:2408.00447", DOI: "10.48550/arXiv.2408.00447", date: "2024-08-01" },
        creators: [{ first: "Only", last: "Editor", role: "editor" }],
      },
      // Relative to Zotero's base directory, which the database doesn't know
      /* 5 */ { type: "attachment", key: "BASE0005", attachment: { parent: 4, linkMode: 2, path: "attachments:papers/p.pdf" } },
      /* 6 */ {
        type: "conferencePaper",
        key: "CONF0006",
        fields: { title: "Attention Is All You Need", url: "http://arxiv.org/abs/1706.03762v5", proceedingsTitle: "NeurIPS", date: "2017-00-00 2017", extra: "Citation Key: vaswani2017" },
        creators: [{ first: "Ashish", last: "Vaswani" }],
      },
      /* 7 */ { type: "journalArticle", key: "DELE0007", fields: { title: "Thrown Away" }, deleted: true },
      /* 8 */ { type: "note", key: "NOTE0008" },
      /* 9 */ { type: "annotation", key: "ANNO0009" },
      /* 10 */ {
        type: "journalArticle",
        key: "EXTR0010",
        fields: { title: "Extra Knows the arXiv Id", url: "https://example.org/x", extra: "tex.ids: x\narXiv: 2101.00001v2 [cs.CL]" },
      },
      /* 11 */ { type: "attachment", key: "SOLO0011", fields: { title: "loose.pdf" }, attachment: { linkMode: 0, path: "storage:loose.pdf" } },
      /* 12 */ { type: "attachment", key: "MISS0012", fields: { title: "missing.pdf" }, attachment: { linkMode: 0, path: "storage:missing.pdf" } },
      /* 13 */ { type: "attachment", key: "LINK0013", attachment: { parent: 10, linkMode: 2, path: linked } },
      /* 14 */ { type: "journalArticle", key: "FEED0014", library: 2, fields: { title: "From a Feed" } },
      /* 15 */ { type: "webpage", key: "WEBP0015", fields: { title: "A Page", url: "https://example.org/page" } },
      // A snapshot is an attachment, but not a PDF
      /* 16 */ { type: "attachment", key: "HTML0016", attachment: { parent: 15, linkMode: 1, contentType: "text/html", path: "storage:page.html" } },
    ],
    [
      { name: "Reading", items: [1, 6, 11] },
      { name: "Transformers", items: [6] },
      { name: "Trashed", items: [1], deleted: true },
    ],
  )
  return { base, dataDir, linked }
}

describe("readSource zotero", () => {
  it("reads papers, their PDFs and standalone PDFs from zotero.sqlite", async () => {
    const { dataDir, linked } = zoteroFixture()
    const before = readFileSync(path.join(dataDir, "zotero.sqlite"))
    const entries = await readSource("zotero", path.join(dataDir, "zotero.sqlite"))

    expect(entries).toEqual([
      {
        key: "JRNL0001",
        title: "A Journal Article",
        authors: ["Ada Lovelace", "World Health Organization"],
        year: 2020,
        venue: "Journal of Tests",
        abstract: "What it found.",
        ids: { doi: "10.1000/xyz.1" },
        pdf: path.join(dataDir, "storage", "STOR0003", "Vaswani et al. - 2017.pdf"),
      },
      { key: "PREP0004", title: "A Preprint", authors: ["Only Editor"], year: 2024, ids: { arxiv: "2408.00447" } },
      { key: "CONF0006", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017, venue: "NeurIPS", ids: { arxiv: "1706.03762" } },
      { key: "EXTR0010", title: "Extra Knows the arXiv Id", authors: [], ids: { arxiv: "2101.00001" }, pdf: linked },
      { key: "SOLO0011", title: "loose.pdf", authors: [], ids: {}, pdf: path.join(dataDir, "storage", "SOLO0011", "loose.pdf") },
      { key: "WEBP0015", title: "A Page", authors: [], ids: { url: "https://example.org/page" } },
    ])
    // Read from a copy: the library itself is untouched
    expect(readFileSync(path.join(dataDir, "zotero.sqlite")).equals(before)).toBe(true)
  })

  it("takes the data folder too, and collections as tags when asked", async () => {
    const { dataDir } = zoteroFixture()
    const entries = await readSource("zotero", dataDir, { collectionsAsTags: true })
    const tags = Object.fromEntries(entries.map((e) => [e.key, e.tags]))
    expect(tags).toEqual({ JRNL0001: ["Reading"], PREP0004: undefined, CONF0006: ["Reading", "Transformers"], EXTR0010: undefined, SOLO0011: ["Reading"], WEBP0015: undefined })
    expect((await readSource("zotero", dataDir)).some((e) => "tags" in e)).toBe(false)
  })

  it("says when there is no library", async () => {
    const base = scratch("zotero-none")
    await expect(readSource("zotero", base)).rejects.toThrow(`There is no Zotero library at ${base}.`)
    const notDb = put(path.join(base, "zotero.sqlite"), "not a database")
    await expect(readSource("zotero", notDb)).rejects.toThrow(`There is no Zotero library at ${notDb}.`)
  })
})

describe("readSource Better BibTeX JSON", () => {
  it("reads the export's items, attachments and collections", async () => {
    const base = scratch("bbt")
    const pdf = put(path.join(base, "storage", "ITEM0001", "paper.pdf"))
    const loose = put(path.join(base, "storage", "LOOSE003", "loose.pdf"))
    const file = path.join(base, "My Library.json")
    writeFileSync(
      file,
      JSON.stringify({
        config: { id: "36a3b0b5-bad0-4a04-b79b-441c7cef77db", label: "BetterBibTeX JSON" },
        collections: { ABCD1234: { key: "ABCD1234", parent: false, name: "Reading", items: [1, 3], collections: [] } },
        items: [
          {
            itemID: 1,
            key: "ITEM0001",
            citationKey: "lovelace2020",
            itemType: "journalArticle",
            title: "A Journal Article",
            DOI: "10.1000/XYZ.1",
            date: "2020-03-01",
            publicationTitle: "Journal of Tests",
            abstractNote: "What it found.",
            creators: [
              { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
              { name: "World Health Organization", creatorType: "author" },
              { firstName: "Ed", lastName: "Itor", creatorType: "editor" },
            ],
            attachments: [{ path: path.join(base, "nowhere.pdf"), title: "Gone" }, { path: "relative.pdf" }, { path: pdf, title: "Full Text PDF" }],
          },
          { itemID: 2, citationKey: "zheng2024", itemType: "preprint", title: "A Preprint", extra: "arXiv: 2408.00447 [cs.HC]", url: "https://arxiv.org/abs/2408.00447v1", creators: [{ firstName: "Chengbo", lastName: "Zheng" }] },
          { itemID: 3, key: "LOOSE003", itemType: "attachment", title: "loose.pdf", path: loose },
          { itemID: 4, key: "NOTE0004", itemType: "note", note: "<p>hi</p>" },
          { itemID: 5, itemType: "webpage", title: "No Key", url: "https://example.org/page" },
        ],
      }),
    )

    const entries = await readSource("zotero", file, { collectionsAsTags: true })
    expect(entries).toEqual([
      {
        key: "ITEM0001",
        title: "A Journal Article",
        authors: ["Ada Lovelace", "World Health Organization"],
        year: 2020,
        venue: "Journal of Tests",
        abstract: "What it found.",
        ids: { doi: "10.1000/xyz.1" },
        pdf,
        tags: ["Reading"],
      },
      { key: "zheng2024", title: "A Preprint", authors: ["Chengbo Zheng"], ids: { arxiv: "2408.00447" } },
      { key: "LOOSE003", title: "loose.pdf", authors: [], ids: {}, pdf: loose, tags: ["Reading"] },
      { key: "entry-5", title: "No Key", authors: [], ids: { url: "https://example.org/page" } },
    ])
  })

  it("says when the file isn't an export", async () => {
    const base = scratch("bbt-bad")
    const file = put(path.join(base, "other.json"), JSON.stringify({ hello: "world" }))
    await expect(readSource("zotero", file)).rejects.toThrow(`${file} isn't a Better BibTeX JSON export.`)
    await expect(readSource("zotero", path.join(base, "none.json"))).rejects.toThrow(`There is no file at ${path.join(base, "none.json")}.`)
  })
})

describe("readSource bibtex", () => {
  it("reads entries written every which way", async () => {
    const entries = await readSource("bibtex", path.join(import.meta.dirname, "fixtures", "tricky.bib"))
    expect(entries).toEqual([
      {
        key: "mueller2020",
        title: "Deep Learning for LaTeX: A Nested Study of Naïve & Façade Pages — 50% Faster",
        authors: ["Jörg Müller", "María García", "Hans Christian Ørsted", "World Health Organization"],
        year: 2020,
        venue: "Journal of ACM Things",
        abstract: "We study many things in depth, pages 10–20.",
        ids: { doi: "10.1145/abc.123_456" },
      },
      {
        key: "Zheng2024DiscipLink",
        title: "DiscipLink: Unfolding Interdisciplinary Information Seeking",
        authors: ["Chengbo Zheng", "Yuanhao Zhang"],
        year: 2024,
        venue: "Proceedings of the CHI Conference on Human Factors in Computing Systems",
        ids: { arxiv: "2408.00447" },
      },
      {
        key: "oldhep",
        title: "Large N field theories, string theory and gravity",
        authors: ["Ofer Aharony", "Steven S. Gubser", "Juan Maldacena", "Hirosi Ooguri", "Yaron Oz"],
        year: 1999,
        ids: { arxiv: "hep-th/9905111" },
      },
      { key: "Doe:2021-x", title: "A Report with a Web Page Only", authors: ["John Doe Jr.", "Andrew Y. Ng"], year: 2021, ids: { url: "https://example.org/report?id=1&v=2" } },
      { key: "entry-5", title: "An Entry without a Key", authors: [], year: 2019, ids: {} },
      { key: "withcrossref", title: "Inheriting a Venue", authors: ["Ann Smith"], venue: "Conf '22", ids: {} },
    ])
  })

  it("says when the file isn't BibTeX", async () => {
    const base = scratch("bib-bad")
    const file = put(path.join(base, "notes.txt"), "Just some notes.")
    await expect(readSource("bibtex", file)).rejects.toThrow(`${file} isn't a BibTeX file.`)
    await expect(readSource("bibtex", path.join(base, "none.bib"))).rejects.toThrow(`There is no file at ${path.join(base, "none.bib")}.`)
    expect(await readSource("bibtex", put(path.join(base, "empty.bib"), ""))).toEqual([])
  })
})

describe("readSource folder", () => {
  it("finds every PDF below the folder, but not in dot-folders", async () => {
    const base = scratch("folder")
    put(path.join(base, "a.pdf"))
    put(path.join(base, "sub", "B.PDF"))
    put(path.join(base, "sub", "notes.txt"), "notes")
    put(path.join(base, "sub", "deeper", "d.pdf"))
    put(path.join(base, ".hidden", "c.pdf"))
    expect(await readSource("folder", base)).toEqual([
      { key: "a.pdf", authors: [], ids: {}, pdf: path.join(base, "a.pdf") },
      { key: "sub/B.PDF", authors: [], ids: {}, pdf: path.join(base, "sub", "B.PDF") },
      { key: "sub/deeper/d.pdf", authors: [], ids: {}, pdf: path.join(base, "sub", "deeper", "d.pdf") },
    ])
    await expect(readSource("folder", path.join(base, "a.pdf"))).rejects.toThrow(`There is no folder at ${path.join(base, "a.pdf")}.`)
  })
})
