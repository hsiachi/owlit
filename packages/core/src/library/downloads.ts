import { execFile } from "node:child_process"
import { readdirSync, watch, type FSWatcher } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

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

// What a PDF says about itself: a DOI on its first pages, and their text
export interface PdfLook {
  doi?: string
  text: string
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
  const from = (await savedFrom(file))?.toLowerCase()
  const sent = from ? waiting.find((p) => p.doi && from.includes(p.doi.toLowerCase())) : undefined
  if (sent) return { id: sent.id, sure: true }
  const said = await look(file)
  if (!said) return undefined
  const text = normalize(said.text)
  const match =
    waiting.find((p) => p.doi && said.doi && p.doi.toLowerCase() === said.doi.toLowerCase()) ??
    waiting.find((p) => normalize(p.title).length >= 20 && text.includes(normalize(p.title)))
  if (match) return { id: match.id, sure: true }
  if (waiting.length === 1 && !said.doi) return { id: waiting[0].id, sure: false }
  return undefined
}

// The addresses a browser recorded the file was saved from (macOS keeps them with the file, as Finder's
// "Where from"), as one string to search, or undefined where there are none. Read as the raw bytes of
// the attribute: the addresses sit in it as plain text, and a DOI only has to be found among them.
export async function savedFrom(file: string): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined
  try {
    const { stdout } = await promisify(execFile)("xattr", ["-px", "com.apple.metadata:kMDItemWhereFroms", file])
    return Buffer.from(stdout.replace(/\s+/g, ""), "hex").toString("latin1")
  } catch {
    return undefined
  }
}

const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
