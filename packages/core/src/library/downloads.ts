import { execFile } from "node:child_process"
import { readdirSync, watch, type FSWatcher } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { surelyOf, type PdfLook } from "./pdf-identity.ts"

// A paper the user opened in their own browser (its publisher isn't letting owlit's in): the PDF they
// save from there is taken from their Downloads folder, so they never have to find it and drop it. For a
// while after Open in browser, each new PDF there is read; one with the paper's DOI or title on its
// first pages is the paper's, and one that names neither, when only one paper waits, is offered to the
// user to confirm. Before reading it, where the browser says it came from is asked: a PDF saved from an
// address with the paper's DOI in it is that paper's, whatever its pages say.

export const WATCH_MS = 15 * 60 * 1000
// A browser writes the file under another name and renames it when done; a moment after the last
// change it is whole
const QUIET_MS = 1500
// The names a download has while it is being written: Chrome's and Dia's "Unconfirmed 123.crdownload"
// and "x.pdf.crdownload", Safari's "x.pdf.download", Firefox's "x.pdf.part"
const PARTIAL = /\.(crdownload|download|part)$/i

export interface WatchedPaper {
  id: string
  doi?: string
  title: string
  until: number
}

export class DownloadWatch {
  private readonly papers = new Map<string, WatchedPaper>()
  private watcher: FSWatcher | null = null
  // Files that were there before, or already looked at
  private readonly seen = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dir: string
  private readonly look: (file: string) => Promise<PdfLook | undefined>
  private readonly found: (id: string, file: string, sure: boolean) => void
  // When a download last moved in the folder (a file being written), whoever's it is
  private moved = 0

  constructor(dir: string, look: (file: string) => Promise<PdfLook | undefined>, found: (id: string, file: string, sure: boolean) => void) {
    this.dir = dir
    this.look = look
    this.found = found
  }

  // A download was being written in the last ms: a large PDF still coming
  busy(ms: number) {
    return Date.now() - this.moved < ms
  }

  // For WATCH_MS from now, or until a given time (a paper sent before a restart keeps its own)
  watch(paper: Omit<WatchedPaper, "until">, until = Date.now() + WATCH_MS) {
    this.papers.set(paper.id, { ...paper, until })
    if (this.watcher) return
    try {
      for (const name of readdirSync(this.dir)) this.seen.add(name)
      this.watcher = watch(this.dir, (_event, name) => name && this.changed(name.toString()))
      this.watcher.on("error", () => this.close())
    } catch (error) {
      console.error("[core] couldn't watch the Downloads folder", error)
    }
  }

  // Until when the paper's PDF is looked for, while it is
  until(id: string) {
    const paper = this.papers.get(id)
    return paper && paper.until > Date.now() ? paper.until : undefined
  }

  stop(id: string) {
    this.papers.delete(id)
    if (!this.papers.size) this.close()
  }

  close() {
    this.watcher?.close()
    this.watcher = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private changed(name: string) {
    // Safari writes inside its x.pdf.download folder, which may be reported as the file in it
    const [top, inside] = name.split(path.sep)
    if (PARTIAL.test(top)) this.moved = Date.now()
    if (inside || !/\.pdf$/i.test(name) || this.seen.has(name)) return
    clearTimeout(this.timers.get(name))
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name)
        void this.consider(name).catch((error) => console.error("[core] couldn't read a downloaded PDF", error))
      }, QUIET_MS),
    )
  }

  private async consider(name: string) {
    const file = path.join(this.dir, name)
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile() || info.size === 0) return
    this.seen.add(name)
    for (const [id, paper] of this.papers) if (paper.until <= Date.now()) this.papers.delete(id)
    const waiting = [...this.papers.values()]
    if (!waiting.length) return this.close()
    const match = await whoseDownload(file, waiting, this.look)
    if (match?.sure) this.stop(match.id)
    if (match) this.found(match.id, file, match.sure)
  }
}

// Which of the waiting papers a downloaded PDF is: sure by where it was saved from or by the paper's DOI
// or title on its pages; unsure when it names neither and only one paper waits
export async function whoseDownload(
  file: string,
  waiting: Omit<WatchedPaper, "until">[],
  look: (file: string) => Promise<PdfLook | undefined>,
): Promise<{ id: string; sure: boolean } | undefined> {
  const from = await savedFrom(file)
  const sent = from ? waiting.find((p) => p.doi && from.some((address) => hasDoi(address, p.doi!))) : undefined
  if (sent) return { id: sent.id, sure: true }
  const said = await look(file)
  if (!said) return undefined
  const match = surelyOf(said, waiting)
  if (match) return { id: match.id, sure: true }
  if (waiting.length === 1 && !said.doi) return { id: waiting[0].id, sure: false }
  return undefined
}

// The addresses a browser recorded the file was saved from (macOS keeps them with the file, as Finder's
// "Where from"), or undefined where there are none
export async function savedFrom(file: string): Promise<string[] | undefined> {
  if (process.platform !== "darwin") return undefined
  try {
    const { stdout } = await promisify(execFile)("xattr", ["-px", "com.apple.metadata:kMDItemWhereFroms", file])
    return addressesIn(Buffer.from(stdout.replace(/\s+/g, ""), "hex"))
  } catch {
    return undefined
  }
}

// The strings in the attribute: a binary property list (an array of strings) as browsers write it, or
// plain text as `xattr -w` does. Read for its strings, so what follows an address in the list (the next
// one's length, the offset table) is never taken for the end of a DOI.
export function addressesIn(attr: Buffer): string[] {
  if (attr.subarray(0, 8).toString("latin1") !== "bplist00") return [attr.toString("utf8")]
  try {
    const trailer = attr.subarray(attr.length - 32)
    const offsetSize = trailer[6]
    const count = Number(trailer.readBigUInt64BE(8))
    const table = Number(trailer.readBigUInt64BE(24))
    const strings: string[] = []
    for (let i = 0; i < count; i++) {
      const at = attr.readUIntBE(table + i * offsetSize, offsetSize)
      const kind = attr[at] >> 4
      // 5: ASCII, 6: UTF-16; anything else (the array) isn't an address
      if (kind !== 5 && kind !== 6) continue
      let length = attr[at] & 0xf
      let start = at + 1
      if (length === 0xf) {
        const size = 1 << (attr[start] & 0xf)
        length = attr.readUIntBE(start + 1, size)
        start += 1 + size
      }
      strings.push(kind === 5 ? attr.toString("latin1", start, start + length) : Buffer.from(attr.subarray(start, start + 2 * length)).swap16().toString("utf16le"))
    }
    return strings
  } catch {
    return []
  }
}

// Whether an address is for this DOI: the DOI whole, ending the address or followed by what can follow it
// in one (?, /, &, #, .pdf), so 10.1145/123456 isn't found in …/10.1145/1234567
export function hasDoi(address: string, doi: string) {
  let text = address
  try {
    text = decodeURIComponent(address)
  } catch {
    // Read as it is
  }
  const escaped = doi.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\w.])${escaped}(?=$|[?/&#]|\\.pdf)`).test(text.toLowerCase())
}
