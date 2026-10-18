import { randomBytes } from "node:crypto"
import { statSync } from "node:fs"
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"

// Write through a temp file and rename, so a crash never leaves half a file behind. parents: false
// for a folder that may be moved or deleted meanwhile (a paper's): the write fails instead of
// bringing the folder back
export async function writeFileAtomic(file: string, data: string | Uint8Array, { parents = true } = {}) {
  if (parents) await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export const writeJsonAtomic = (file: string, value: unknown, options?: { parents?: boolean }) =>
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n", options)

// undefined when the file is missing; a file that isn't valid JSON throws
export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

// The temp files writeFileAtomic leaves for a moment beside the file it writes
export const ATOMIC_TEMP = /\.[0-9a-f]{8}\.tmp$/

export const exists = (file: string) => stat(file).then(() => true, () => false)

// Whether nothing is at a path. Unlike !existsSync, a folder owlit may not look into (EPERM, from macOS
// privacy settings) or a drive that isn't mounted yet is there.
export function isMissing(file: string) {
  try {
    statSync(file)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return (code === "ENOENT" || code === "ENOTDIR") && !file.startsWith("/Volumes/")
  }
}

// For a .catch() where a file that isn't there is fine
export function ignoreMissing(error: NodeJS.ErrnoException) {
  if (error.code !== "ENOENT") throw error
}

// For a mkdir() .catch() where a folder already there is fine (and a missing parent isn't)
export function ignoreExisting(error: NodeJS.ErrnoException) {
  if (error.code !== "EEXIST") throw error
}

// One value per line, in order. A missing file is empty, and a line that doesn't parse (a write cut short
// by a crash, an edit by hand) is skipped so the others still count; onBad hears about it.
export async function readJsonl<T>(file: string, onBad?: (line: string) => void): Promise<T[]> {
  const text = await readFile(file, "utf8").catch(() => "")
  const values: T[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      values.push(JSON.parse(line) as T)
    } catch {
      onBad?.(line)
    }
  }
  return values
}

export async function appendJsonl(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify(value) + "\n")
}
