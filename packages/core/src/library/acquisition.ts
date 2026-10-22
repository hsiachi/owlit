import type { PdfState, PdfTry } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { clean, type Serial } from "../util.ts"
import { paperDir } from "./paths.ts"
import { hasPdfFile, pdfFile } from "./pdf.ts"

// Where getting a paper's PDF stands, kept in library/papers/<id>/acquisition.json. This module is its
// only reader and writer: every try at the PDF, by anyone, is one entry in `tried`, and `state` is worked
// out from them in one function (standing), so nothing else decides it again.

export type { PdfTry }

// have-it: the PDF was placed (and paper.pdf is there); the window never sees it as a state
export type PdfStanding = PdfState["state"] | "have-it"

export interface Acquisition {
  version: 2
  state: PdfStanding
  // Newest last, at most MAX_TRIES
  tried: PdfTry[]
  // Where a PDF found by hand goes
  dropHere: string
  // The route that gave the PDF in place, and its SHA-256, so the same file dropped again is recognised
  route?: string
  sha256?: string
  // How many of owlit's looks in a row found no PDF, for spacing out the daily look (lookDue)
  looks?: number
}

// Enough for every route of several looks; the daily look adds a few each time, so older ones go
const MAX_TRIES = 60

// The daily look for a paper without a PDF, spaced out the longer nothing comes: a day after the first
// look, then 3, 7 and 30 days, since a daily look at every such paper visits their publishers dozens of
// times a day for nothing. After the look at the end of the last step it stops: open copies that turn up
// later are rare, and a paper looked for every month for ever is a paper nobody is told about. The user's
// Look again, or Get them all, is one more look, and the card says owlit won't look again on its own.
const LOOK_AGAIN_DAYS = [1, 3, 7, 30]
const DAY_MS = 24 * 60 * 60 * 1000

// Where the paper stands after these tries, and the try that says why. Finding before any try, and while
// the newest found nothing reachable; have-it once the newest brought the PDF. Otherwise no PDF, for
// the reason of the newest try since the last PDF, except where owlit's own try says less than an
// earlier one: finding no open copy hides nothing (a library that said no still hasn't got it), and a
// page that stopped owlit itself with a check or a sign-in doesn't hide what the user's browser, which
// gets past those, was told.
//
// A reason that is the extension waiting for the user (a check, a block or a sign-in in their browser,
// or the extension not allowed on the site) leaves the paper finding: the user gets through once for the whole
// site and owlit goes on by itself. A check or a sign-in that owlit itself met (only older records have
// one) waits on nobody: it is a reason for no PDF like any other, until the extension tries the paper.
export function standing(tried: readonly PdfTry[]): { state: PdfStanding; reason?: PdfTry } {
  const newest = tried.at(-1)
  if (!newest) return { state: "finding" }
  if (newest.ended === "offline") return { state: "finding", reason: newest }
  if (newest.ended === "pdf") return { state: "have-it", reason: newest }
  let reason: PdfTry | undefined
  for (const t of tried) {
    if (t.ended === "pdf") reason = undefined
    else if (t.ended === "offline") continue
    else if (!reason || !saysLess(t, reason)) reason = t
  }
  reason ??= newest
  return { state: waitsForUser(reason) ? "finding" : "no-pdf", reason }
}

// The extension's fetch stopped where only the user can get through, for every paper of that site
export const waitsForUser = (t: PdfTry) => t.by === "extension" && (t.ended === "check" || t.ended === "blocked" || t.ended === "sign-in" || t.ended === "no-permission")

// Whether a paper goes to the extension's queue when the extension connects, and the try that says why
// (whose time orders the queue, oldest first). The queue lives in memory, so after a restart, or before
// the extension ever asked for work, it holds nothing; this is what fills it again. Taken: a paper still
// finding while the extension waits for the user at its site or reached nothing there (its fetch was
// put back in its queue, which a restart emptied), and one with no PDF for owlit's own reason
// (no copy, or an older record's check or sign-in) that the extension hasn't tried since its last PDF.
// Not one the extension already judged (no access, not there, its own no copy): owlit's back-off look
// hands that one over again when it is due.
export function forExtension(acquisition: Pick<Acquisition, "state" | "tried">): PdfTry | undefined {
  const { reason } = standing(acquisition.tried)
  if (!reason) return undefined
  if (acquisition.state === "finding") return waitsForUser(reason) || (reason.by === "extension" && reason.ended === "offline") ? reason : undefined
  if (acquisition.state !== "no-pdf" || reason.by !== "search" || !OWLIT_ONLY.has(reason.ended)) return undefined
  const sincePdf = acquisition.tried.slice(acquisition.tried.findLastIndex((t) => t.ended === "pdf") + 1)
  return sincePdf.some((t) => t.by === "extension") ? undefined : reason
}

const OWLIT_ONLY: ReadonlySet<PdfTry["ended"]> = new Set(["no-copy", "check", "sign-in"])

const saysLess = (later: PdfTry, earlier: PdfTry) =>
  later.by === "search" && ((later.ended === "no-copy" && earlier.ended !== "no-copy") || ((later.ended === "check" || later.ended === "sign-in") && earlier.by !== "search"))

// When owlit's back-off look is next due for a paper without its PDF: from its newest look, after
// LOOK_AGAIN_DAYS by how many found nothing; undefined once every step was taken (owlit won't look again
// on its own) and while it isn't spaced out (finding). A record that had the PDF is asked only when its
// file is gone (deleted outside owlit): due since then, since nothing else looks for it.
export function nextLookAt(acquisition: Pick<Acquisition, "state" | "tried" | "looks">) {
  if (acquisition.state === "have-it") return acquisition.tried.at(-1)?.at ?? 0
  if (acquisition.state !== "no-pdf") return undefined
  const looks = Math.max(acquisition.looks ?? 1, 1)
  if (looks > LOOK_AGAIN_DAYS.length) return undefined
  const last = acquisition.tried.findLast((t) => t.by === "search")?.at ?? acquisition.tried.at(-1)?.at ?? 0
  return last + LOOK_AGAIN_DAYS[looks - 1] * DAY_MS
}

// Whether the daily look takes the paper now: a paper with no PDF once its back-off is over, one whose
// PDF was had and is gone (the caller skips papers with their file), and one still finding because
// nothing could be reached, which has no back-off to wait for. One waiting for the
// user at the extension's site isn't: owlit's own routes found nothing for it already, and the extension's
// queue takes it again when the extension connects (forExtension).
export function lookDue(acquisition: Pick<Acquisition, "state" | "tried" | "looks">, now: number) {
  if (acquisition.state === "finding") return acquisition.tried.at(-1)?.ended === "offline"
  const next = nextLookAt(acquisition)
  // A little early is fine: a look that ran at 9:05 yesterday is due at 9:00 today
  return next !== undefined && now >= next - 60 * 60 * 1000
}

// ---- Reading and writing

export const acquisitionFile = (root: string, id: string) => path.join(paperDir(root, id), "acquisition.json")

// The paper's record, or undefined before owlit looked
export const readAcquisition = (root: string, id: string) =>
  readJson<Acquisition>(acquisitionFile(root, id)).then(
    (raw) => (raw && typeof raw === "object" && raw.version === 2 && Array.isArray(raw.tried) ? raw : undefined),
    () => undefined,
  )

const write = (root: string, id: string, acquisition: Acquisition) => writeJsonAtomic(acquisitionFile(root, id), acquisition, { parents: false })

// A PDF in place: how it came. by "person" for a file the user dropped or chose; route names the way
// ("dropped", "arxiv", "extension:journals.sagepub.com")
export interface Placed {
  by: PdfTry["by"]
  route: string
  sha256: string
}

interface Locking {
  // The paper may have moved or gone to the trash while this waited for the lock: nothing is written
  signal?: AbortSignal
  // The caller already holds the library's lock (Serial isn't reentrant)
  held?: boolean
}

// The writers, each under the library's lock, so a try noted by one way never lands over a PDF another
// way just placed
export class Acquisitions {
  private readonly root: string
  private readonly serial: Serial

  constructor(root: string, serial: Serial) {
    this.root = root
    this.serial = serial
  }

  read(id: string) {
    return readAcquisition(this.root, id)
  }

  // What the window is shown for a paper without its PDF; where the extension has it is added by the
  // library, whose queue keeps it in memory
  async shown(id: string): Promise<PdfState> {
    const acquisition = await this.read(id)
    if (!acquisition) return { state: "finding", tried: [] }
    const { reason } = standing(acquisition.tried)
    // A PDF placed and then taken away outside owlit: finding, its reason the PDF it had, which says so,
    // with the daily look due for it
    const state = acquisition.state === "have-it" ? "finding" : acquisition.state
    const nextLook = nextLookAt(acquisition)
    return clean({ state, tried: acquisition.tried, reason, nextLook })
  }

  // Tries that ended without the PDF, appended; look: they were owlit's look through its routes, which
  // counts towards spacing the next one out. Whether they were noted: not when a PDF is in place
  // (another way placed it meanwhile, and its record stands).
  noteTried(id: string, tries: PdfTry | PdfTry[], options: Locking & { look?: boolean } = {}): Promise<boolean> {
    return this.locked(options, async () => {
      if (await hasPdfFile(this.root, id)) return false
      const previous = await this.read(id)
      const tried = [...(previous?.tried ?? []), ...[tries].flat()].slice(-MAX_TRIES)
      const looks = options.look ? (previous?.state === "no-pdf" ? (previous.looks ?? 1) : 0) + 1 : previous?.looks
      await write(this.root, id, this.next(id, previous, tried, { looks }))
      return true
    })
  }

  // The paper's PDF in place. place, when given, moves the file there under the same lock, after the
  // signal is checked, so the file and its record always change together.
  notePlaced(id: string, placed: Placed, options: Locking & { place?: () => Promise<void> } = {}): Promise<void> {
    return this.locked(options, async () => {
      await options.place?.()
      const previous = await this.read(id)
      const tried = [...(previous?.tried ?? []), { by: placed.by, ended: "pdf" as const, at: Date.now(), route: placed.route }].slice(-MAX_TRIES)
      await write(this.root, id, this.next(id, previous, tried, { route: placed.route, sha256: placed.sha256 }))
    })
  }

  // The SHA-256 of the PDF in place, worked out once for a record that hasn't got it
  noteHash(id: string, sha256: string, options: Locking = {}): Promise<void> {
    return this.locked(options, async () => {
      const previous = await this.read(id)
      if (previous) await write(this.root, id, this.next(id, previous, previous.tried, { sha256 }))
    })
  }

  // The one place a record is put together: the tries decide the state; what carries over from the
  // record before is listed here and nowhere else
  private next(id: string, previous: Acquisition | undefined, tried: PdfTry[], change: Partial<Pick<Acquisition, "looks" | "route" | "sha256">>): Acquisition {
    const { state } = standing(tried)
    const placed = state === "have-it"
    return clean({
      version: 2 as const,
      state,
      tried,
      dropHere: pdfFile(this.root, id),
      // Of the PDF in place only
      route: placed ? (change.route ?? previous?.route) : undefined,
      sha256: placed ? (change.sha256 ?? previous?.sha256) : undefined,
      // Of the looks since the last PDF only
      looks: placed ? undefined : "looks" in change ? change.looks : previous?.looks,
    })
  }

  private locked<T>(options: Locking, work: () => Promise<T>): Promise<T> {
    const run = async () => {
      options.signal?.throwIfAborted()
      return work()
    }
    return options.held ? run() : this.serial.run(run)
  }
}
