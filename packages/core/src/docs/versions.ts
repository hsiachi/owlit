import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// One snapshot: a file as it was before an agent wrote it
export interface Version {
  id: string
  path: string
  at: number
  chatId?: string
  // Whether the file existed before; restoring a version of a file that didn't removes it
  existed: boolean
  // sha1 of what the agent wrote, so a restore can tell whether anyone changed the file since
  after: string
  // The agent deleted the file; restoring writes it back
  deleted?: true
}

export const sha1 = (text: string) => createHash("sha1").update(text).digest("hex")

// .owlit/versions/: before every agent write, the file's text goes to <ts>-<path with / as __>, and a
// line describing it to index.jsonl. Undo after the editor is gone restores from here.
export class Versions {
  private readonly dir: string

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "versions")
  }

  // after is null when the agent deleted the file
  async save(rel: string, before: string | null, after: string | null, chatId?: string): Promise<Version> {
    const at = Date.now()
    const id = `${at}-${rel.replaceAll("/", "__")}`
    const version: Version = {
      id,
      path: rel,
      at,
      ...(chatId ? { chatId } : {}),
      existed: before !== null,
      after: sha1(after ?? ""),
      ...(after === null ? { deleted: true as const } : {}),
    }
    await mkdir(this.dir, { recursive: true })
    await writeFile(path.join(this.dir, id), before ?? "")
    await appendFile(path.join(this.dir, "index.jsonl"), JSON.stringify(version) + "\n")
    return version
  }

  // The version and the text it kept, or null when it isn't there
  async get(id: string): Promise<(Version & { before: string }) | null> {
    if (id.includes("/") || id.startsWith(".")) return null
    const index = await readFile(path.join(this.dir, "index.jsonl"), "utf8").catch(() => "")
    const line = index.split("\n").findLast((l) => l.includes(`"id":${JSON.stringify(id)}`))
    if (!line) return null
    const version = JSON.parse(line) as Version
    const before = await readFile(path.join(this.dir, id), "utf8").catch(() => null)
    return before === null ? null : { ...version, before }
  }
}
