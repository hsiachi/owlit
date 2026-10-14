import type { Chat, CitedPassage, CollectedPassage, Collection, CollectionSummary, PaperWear } from "@owlit/protocol"
import { itemId, parseOwlitUri, QUESTION_COLUMN, shownCollection } from "@owlit/protocol"
import { readJournal, readingOf } from "../activity/reading.ts"
import type { Chats } from "../chats/chats.ts"

// What has been read of a paper: the sentences Owlit's answers rested on, taken from the chats and the
// collections as they are now (a deleted chat, a regenerated answer or a removed row takes its marks with
// it), and the pages the person stayed on, from the journal. Nothing is stored for this; it is read again whenever a paper opens.

// A citation in Markdown: [label](owlit://library/<id>#p4 "the sentence"), the title optional
const CITATION = /\]\((owlit:\/\/library\/[^\s)]+)(?:\s+"((?:\\.|[^"\\])*)")?\)/g

export interface Citation {
  paperId: string
  page?: number
  quote?: string
}

export function citationsIn(text: string): Citation[] {
  const out: Citation[] = []
  for (const m of text.matchAll(CITATION)) {
    const uri = parseOwlitUri(m[1])
    if (uri?.kind !== "paper") continue
    const quote = m[2]?.replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim()
    out.push({ paperId: uri.id, ...(uri.page ? { page: uri.page } : {}), ...(quote ? { quote } : {}) })
  }
  return out
}

type Cited = Omit<CitedPassage, "chatTitle"> & { paperId: string }

// A chat's citations that carry a sentence. Chats hands out a new object whenever a chat changes (an
// answer streamed in, a message removed), so the chat itself is the key; its updatedAt doesn't move
// while an answer streams.
const byChat = new WeakMap<Chat, Cited[]>()

function citedIn(chat: Chat): Cited[] {
  const known = byChat.get(chat)
  if (known) return known
  const cited: Cited[] = []
  for (const m of chat.messages) {
    if (m.role !== "assistant") continue
    for (const part of m.parts) {
      if (part.type !== "text") continue
      for (const c of citationsIn(part.text))
        if (c.quote) cited.push({ paperId: c.paperId, quote: c.quote, ...(c.page ? { page: c.page } : {}), chatId: chat.id, messageId: m.id, at: m.createdAt })
    }
  }
  byChat.set(chat, cited)
  return cited
}

interface CollectionsReader {
  list(): Promise<CollectionSummary[]>
  get(id: string): Promise<Collection>
}

// The answers in collections that rest on the paper's own words: cells read in full, with their passage.
// The user's rewrite of an answer keeps the passage Owlit found.
async function collectedOf(id: string, collections: CollectionsReader, alias: (id: string) => string): Promise<CollectedPassage[]> {
  const out: CollectedPassage[] = []
  for (const summary of await collections.list()) {
    const c = await collections.get(summary.id).catch(() => null)
    if (!c) continue
    const shown = shownCollection(c)
    for (const row of shown.rows) {
      if (alias(row.id) !== id) continue
      for (const col of shown.columns) {
        const passage = row.cells[col.id]?.passage
        if (!passage?.quote || row.cells[col.id]?.depth !== "full") continue
        out.push({
          quote: passage.quote,
          ...(passage.page ? { page: passage.page } : {}),
          collectionId: c.id,
          collectionTitle: shown.title,
          row: row.id,
          ...(col.id !== QUESTION_COLUMN && col.kind !== "compare" ? { column: col.question } : {}),
          at: c.changedAt[itemId.cell(row.id, col.id)] ?? c.updatedAt,
        })
      }
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

export async function wearOf(
  paperId: string,
  { chats, collections, journal, aliases }: { chats: Chats; collections: CollectionsReader; journal: string; aliases: Record<string, string> },
): Promise<PaperWear> {
  const alias = (id: string) => aliases[id] ?? id
  const id = alias(paperId)
  const cited: CitedPassage[] = []
  for (const summary of await chats.list()) {
    // The same sentence cited twice in one answer is one mark
    const seen = new Set<string>()
    const chat = await chats.get(summary.id).catch(() => null)
    for (const { paperId: cites, ...c } of chat ? citedIn(chat) : []) {
      const key = `${c.messageId}|${c.quote}`
      if (alias(cites) !== id || seen.has(key)) continue
      seen.add(key)
      cited.push({ ...c, chatTitle: summary.title })
    }
  }
  cited.sort((a, b) => a.at - b.at)
  const pages = readingOf(await readJournal(journal), alias).get(id)?.pages ?? {}
  return { cited, collected: await collectedOf(id, collections, alias), pages }
}
