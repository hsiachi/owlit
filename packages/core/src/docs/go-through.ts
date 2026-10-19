import { chatOfFile, chatUri, docUri, isMarkdown, parentPath } from "@owlit/protocol"
import { goThroughRecipe, isChinese, MEETINGS, MEETINGS_FOLDER } from "../recipes/go-through.ts"
import type { Workspace } from "../workspace/workspace.ts"

// What a Go through's chat is given (core.ts goThrough): the recipe, naming where the record goes and the
// docs to read the material against, and the material's text to send after it

// Long material is cut here: a 30-minute meeting's transcript is about a fifth of it
const MATERIAL_LIMIT = 120_000

export interface GoThroughWork {
  // The material by name, for the chat's title
  name: string
  recipe: string
  text: string
  // Where the record is to be written
  record: string
}

// rel: the material, a doc, or a file attached to a chat. An attached file is a copy in owlit's own
// folder, which Docs refuses: it is read from disk, its record goes in the workspace's Meetings folder
// rather than beside it, and the record links to the chat. null: there is nothing in it to go through.
export async function goThroughWork(ws: Workspace, rel: string, { today, user }: { today: string; user?: string }): Promise<GoThroughWork | null> {
  const chat = chatOfFile(rel)
  const content = chat ? await ws.docs.readDisk(rel) : (await ws.docs.read(rel)).content
  if (!content?.trim()) return null
  const chinese = isChinese(content)
  const name = rel.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "")
  const record = ws.docs.freePath(chat ? MEETINGS_FOLDER : parentPath(rel), `${name} · ${chinese ? "解读" : "reading"}`, ".md")
  const docs = (await ws.docs.list()).files.map((f) => f.path).filter((p) => p !== rel && isMarkdown(p) && !MEETINGS.test(p))
  const cut = content.length > MATERIAL_LIMIT
  const recipe = goThroughRecipe({
    path: rel,
    ...(cut ? { cut } : {}),
    record,
    recordLabel: record.split("/").pop()!.replace(/\.md$/i, ""),
    materialLink: chat ? chatUri(chat) : docUri(rel),
    chinese,
    docs,
    today,
    ...(user ? { user } : {}),
  })
  return { name, recipe, text: cut ? content.slice(0, MATERIAL_LIMIT) : content, record }
}
