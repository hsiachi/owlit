// The example workspace: a copy of the one shipped with the app, made where a new workspace would go, for
// someone who wants to look around before bringing their own papers. Its times move up to just before now,
// so its papers read as added lately and Home has something to continue.

import { existsSync } from "node:fs"
import { cp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

const NAME = "Owlit Example"
const HOUR = 3_600_000
// Epoch milliseconds between 2017 and 2049: a timestamp, not a count or a page number
const isTime = (key: string, value: unknown): value is number => typeof value === "number" && /(^at|At)$/.test(key) && value > 1.5e12 && value < 2.5e12

// The folder for the example in parent, copied from source unless an earlier copy is there to open again
export async function copyExample(source: string, parent: string, now = Date.now()) {
  let folder = path.join(parent, NAME)
  for (let n = 2; existsSync(folder); n++) {
    if (existsSync(path.join(folder, ".owlit", "workspace.json"))) return folder
    folder = path.join(parent, `${NAME} ${n}`)
  }
  await cp(source, folder, { recursive: true, errorOnExist: true, force: false })
  await moveTimes(folder, now)
  return folder
}

// Shifts every timestamp in owlit's own records, and every file's modified time, by one amount, so the
// latest thing in the workspace happened an hour before now
async function moveTimes(folder: string, now: number) {
  const files = await walk(folder)
  const records = files.filter((f) => /\.jsonl?$/.test(f) && (f.includes(`${path.sep}.owlit${path.sep}`) || /[/\\]library[/\\]papers[/\\][^/\\]+[/\\](paper|digest)\.json$/.test(f)))
  const texts = await Promise.all(records.map((f) => readFile(f, "utf8")))
  let latest = 0
  const visit = (value: unknown, change?: (t: number) => number): unknown => {
    if (Array.isArray(value)) return value.map((v) => visit(v, change))
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (!isTime(k, v)) return [k, visit(v, change)]
        latest = Math.max(latest, v)
        return [k, change ? change(v) : v]
      }),
    )
  }
  const parse = (text: string, file: string) => (file.endsWith(".jsonl") ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(text)])
  texts.forEach((text, i) => parse(text, records[i]).forEach((v) => visit(v)))
  if (!latest) return
  const delta = now - HOUR - latest
  await Promise.all(
    records.map((file, i) => {
      const values = parse(texts[i], file).map((v) => visit(v, (t) => t + delta))
      const text = file.endsWith(".jsonl") ? values.map((v) => JSON.stringify(v)).join("\n") + "\n" : JSON.stringify(values[0], null, 2) + "\n"
      return writeFile(file, text)
    }),
  )
  await Promise.all(
    files.map(async (file) => {
      const { mtimeMs } = await stat(file)
      const at = new Date(Math.min(now, mtimeMs + delta))
      await utimes(file, at, at)
    }),
  )
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])))
  return nested.flat()
}
