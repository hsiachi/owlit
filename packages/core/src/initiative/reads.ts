import { readFile } from "node:fs/promises"
import path from "node:path"
import { fullReadAt, readJournal } from "../activity/reading.ts"
import { paperDir } from "../library/paths.ts"
import type { Workspace } from "../workspace/workspace.ts"

// When the user's reading of a paper reaches the whole of it (reading.ts › readInFull): looked at as each
// visit to a paper ends, from the journal, so it is said once, on the visit that got there

// The paper's pages, as its text counts them (text.md marks each page); null without a text
async function pagesOf(ws: Workspace, paperId: string) {
  const markdown = await readFile(path.join(paperDir(ws.root, paperId), "text.md"), "utf8").catch(() => null)
  return markdown ? (markdown.match(/<!-- page \d+ -->/g)?.length ?? 0) || null : null
}

export async function becameReadInFull(ws: Workspace, paperId: string, closedAt: number) {
  const aliases = await ws.library.aliases().catch(() => ({}) as Record<string, string>)
  const alias = (id: string) => aliases[id] ?? id
  const id = alias(paperId)
  const entries = await readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])
  return fullReadAt(entries, id, closedAt, await pagesOf(ws, id), alias)
}
