import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

// Write through a temp file and rename, so a crash never leaves half a file behind
export async function writeFileAtomic(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export const writeJsonAtomic = (file: string, value: unknown) =>
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n")

// undefined when the file is missing; a file that isn't valid JSON throws
export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}
