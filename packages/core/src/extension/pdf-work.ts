import type { ExtensionWait, GateKey, LaneKey, WorkEnding } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { Serial } from "../util.ts"

// What this machine keeps about getting a workspace's PDFs through the browser, beside the papers'
// records: <dataDir>/pdf-work.json (per workspace and per machine, as library.json). The waits themselves
// are rebuilt from the papers' tries as the workspace opens (ExtensionWork.restore); kept here is only
// what the tries can't say:
// - each wait's follow-ups (the user opened its page, said they got through, the papers that went on
//   then), by gate and since, so an earlier wait's never attach to a later one at the same gate;
// - a tally per gate of what was handed to the extension and how it ended, which tells a gate that
//   quietly gives nothing (silentZeros) from one that waits on the user;
// - the papers in the extension's queues, so after a restart they read as with the browser from the
//   moment the workspace opens, not as their records alone say (no copy found by owlit's own routes),
//   until the extension asks again and they are queued anew.

// How long a follow-up outlives its wait, and how far back the tally looks for a silent zero
export const FOLLOW_UP_MS = 24 * 60 * 60_000
// A gate handed this many papers in FOLLOW_UP_MS with no PDF and no wait gives nothing without saying
// why: a page the extension misreads, most likely. Fewer is ordinary bad luck (a few closed papers).
export const SILENT_ZERO_HANDED = 5
// Hand-outs kept per gate for the window above; more than enough to tell SILENT_ZERO_HANDED
const RECENT_KEPT = 50
// Writes are put off this long, so a run of changes (a resume freeing thirty papers) is one write
const WRITE_DELAY_MS = 500

export interface FollowUp {
  gate: GateKey
  since: number
  // The wait is up, as owlit last knew it: a restart takes its since back (restore)
  up: boolean
  // How it was shown when last up (ExtensionWait.kind, .at, .proxied), for its line once it went
  kind: ExtensionWait["kind"]
  host: string
  // ExtensionWait.watch, for the popup to say its papers go on at those hosts once it went
  watch?: string[]
  proxied: boolean
  opened?: { at: number; browser?: string }
  retried?: { at: number; again: boolean }
  // The papers that went on when the user got through (Going)
  going?: Going
}

// The papers that went on after the user got through at a gate: since at, and since from[id] for each
// that went on at a later time (the user got through there again), which its ending is counted from
export interface Going {
  at: number
  ids: string[]
  from?: Record<string, number>
}

export interface GateTally {
  handed: number
  pdfs: number
  endings: Partial<Record<WorkEnding, number>>
  lastPdfAt?: number
  // When papers were handed out lately, oldest first
  recent: number[]
}

// A paper in the extension's queues, as PdfState.extension says where it is
export interface QueuedNote {
  lane: LaneKey
  gate: GateKey
  at: string
}

interface File {
  version: 1
  followUps: FollowUp[]
  tally: Record<string, GateTally>
  // When the user last got through at each gate (resume)
  resumed?: Record<string, number>
  // By paper id
  queued?: Record<string, QueuedNote>
}

export class PdfWorkNotes {
  // Settled once the file was read; what changed before then is kept over what it held
  readonly loaded: Promise<void>
  private followUps: FollowUp[] = []
  private readonly tally = new Map<GateKey, GateTally>()
  private readonly resumes = new Map<GateKey, number>()
  private queue = new Map<string, QueuedNote>()
  // The queue was set before the file was read: what the file held is added to it, not replaced by it
  private queueSet = false
  private readonly file: string | undefined
  private readonly delayMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly writes = new Serial()

  // dataDir: none for a library that keeps nothing on this machine (tests). after: the write of the
  // notes this replaces (another workspace opened, and this one again), read only once it is done: read
  // before, the file would lack what was still to be written
  constructor(dataDir: string | undefined, { delayMs = WRITE_DELAY_MS, after }: { delayMs?: number; after?: Promise<unknown> } = {}) {
    this.file = dataDir && path.join(dataDir, "pdf-work.json")
    this.delayMs = delayMs
    this.loaded = (after ?? Promise.resolve()).catch(() => undefined).then(() => this.load())
  }

  // ---- Follow-ups

  get(gate: GateKey, since: number): FollowUp | undefined {
    return this.followUps.find((f) => f.gate === gate && f.since === since)
  }

  // The follow-ups of the wait as it is shown now, made when it has none
  of(wait: { gate: GateKey; since: number; kind: ExtensionWait["kind"]; at: string; watch?: string[] }): FollowUp {
    let follow = this.get(wait.gate, wait.since)
    if (!follow) {
      follow = { gate: wait.gate, since: wait.since, up: true, kind: wait.kind, host: wait.at, proxied: wait.gate.startsWith("proxy:") }
      this.followUps.push(follow)
    }
    Object.assign(follow, { up: true, kind: wait.kind, host: wait.at, ...(wait.watch ? { watch: wait.watch } : {}) })
    this.changed()
    return follow
  }

  // The wait that was up at this gate when owlit last ran, for restore to take its since back
  upAt(gate: GateKey): FollowUp | undefined {
    return this.followUps.find((f) => f.gate === gate && f.up)
  }

  // The wait whose papers went on (going) includes this one, which has just met the same gate again:
  // it is that wait back, not a new one
  goingWith(gate: GateKey, paperId: string): FollowUp | undefined {
    return this.followUps.find((f) => f.gate === gate && !f.up && f.going?.ids.includes(paperId))
  }

  // The wait went. Its follow-ups stay only while its papers going on are still to be shown: one line per
  // gate, so a gate the user got through at again while its last papers still went on adds to that line.
  // A line whose papers have all ended (stillGoing: none of them is) is over: a new one replaces it, and
  // never counts its papers as its own.
  down(gate: GateKey, since: number, going?: string[], stillGoing: (paperId: string) => boolean = () => true) {
    const follow = this.get(gate, since)
    if (!follow) return
    follow.up = false
    follow.opened = undefined
    if (going) {
      const at = Date.now()
      const lines = this.followUps.filter((f) => f !== follow && f.gate === gate && !f.up && f.going)
      for (const over of lines.filter((f) => !f.going!.ids.some(stillGoing))) over.going = undefined
      const earlier = lines.find((f) => f.going)
      const into = earlier ?? follow
      into.going = into.going ? goOnWith(into.going, going, at) : { at, ids: going }
      if (earlier) {
        // Said as the newest wait was
        Object.assign(earlier, { kind: follow.kind, host: follow.host, proxied: follow.proxied, ...(follow.watch ? { watch: follow.watch } : {}) })
        follow.going = undefined
      }
    }
    this.followUps = this.followUps.filter((f) => f.up || f.going)
    this.changed()
  }

  // The paper is one of a line going on, whose counts the extension's popup shows
  inGoing(paperId: string): boolean {
    return this.followUps.some((f) => f.going?.ids.includes(paperId))
  }

  // The waits that went, with papers that went on
  gone(): FollowUp[] {
    return this.followUps.filter((f) => !f.up && f.going)
  }

  // Every wait at the gate that went has its line put away, and one that is up loses its going
  dismissGoing(gate: GateKey): boolean {
    const had = this.followUps.some((f) => f.gate === gate && f.going)
    for (const f of this.followUps) if (f.gate === gate) f.going = undefined
    this.followUps = this.followUps.filter((f) => f.up || f.going)
    if (had) this.changed()
    return had
  }

  // Follow-ups for waits that aren't up any more go (a restore that found no paper under them)
  keepUp(gates: (follow: FollowUp) => boolean) {
    for (const f of this.followUps) if (f.up && !gates(f)) Object.assign(f, { up: false, opened: undefined })
    this.followUps = this.followUps.filter((f) => f.up || f.going)
    this.changed()
  }

  changed() {
    this.save()
  }

  // The user got through at this gate (they said so, or the extension saw it). A try that met a wait
  // there earlier says nothing any more: restore puts no wait up from it.
  resumed(gate: GateKey, at = Date.now()) {
    this.resumes.set(gate, Math.max(at, this.resumes.get(gate) ?? 0))
    this.save()
  }

  resumedAt(gate: GateKey): number | undefined {
    return this.resumes.get(gate)
  }

  // ---- The queues

  // The papers in the extension's queues now, written down when they change
  setQueued(queued: Map<string, QueuedNote>) {
    const same = queued.size === this.queue.size && [...queued].every(([id, q]) => JSON.stringify(this.queue.get(id)) === JSON.stringify(q))
    this.queue = new Map(queued)
    this.queueSet = true
    if (!same) this.save()
  }

  queuedIds(): ReadonlySet<string> {
    return new Set(this.queue.keys())
  }

  // Where the paper was in the extension's queues when they were last written down
  queuedOf(paperId: string): QueuedNote | undefined {
    return this.queue.get(paperId)
  }

  // ---- The tally

  handed(gate: GateKey, at = Date.now()) {
    const t = this.tallyOf(gate)
    t.handed++
    t.recent = [...t.recent.filter((r) => r > at - FOLLOW_UP_MS), at].slice(-RECENT_KEPT)
    this.save()
  }

  pdf(gate: GateKey, at = Date.now()) {
    const t = this.tallyOf(gate)
    t.pdfs++
    t.lastPdfAt = at
    this.save()
  }

  ended(gate: GateKey, ending: WorkEnding) {
    const t = this.tallyOf(gate)
    t.endings[ending] = (t.endings[ending] ?? 0) + 1
    this.save()
  }

  tallies(): ReadonlyMap<GateKey, Readonly<GateTally>> {
    return this.tally
  }

  // Gates handed SILENT_ZERO_HANDED papers or more in the last FOLLOW_UP_MS that brought no PDF in it,
  // not counting those that stopped where a wait said why, which may have gone since (the user stopped
  // the papers); whether a wait up now explains the rest is the caller's to say
  quiet(now = Date.now()): GateKey[] {
    const from = now - FOLLOW_UP_MS
    const said = ({ endings: e }: GateTally) => (e.check ?? 0) + (e["sign-in"] ?? 0) + (e.blocked ?? 0) + (e["no-permission"] ?? 0)
    return [...this.tally].filter(([, t]) => t.recent.filter((r) => r > from).length - said(t) >= SILENT_ZERO_HANDED && !((t.lastPdfAt ?? 0) > from)).map(([gate]) => gate)
  }

  // ---- The file

  // What is still to be written, written now (owlit quits, another workspace opens)
  async flush() {
    await this.loaded
    clearTimeout(this.timer)
    this.timer = undefined
    await this.write()
  }

  private tallyOf(gate: GateKey): GateTally {
    let t = this.tally.get(gate)
    if (!t) {
      t = { handed: 0, pdfs: 0, endings: {}, recent: [] }
      this.tally.set(gate, t)
    }
    return t
  }

  private save() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.loaded.then(() => this.write()).catch((error) => console.error("[core] couldn't keep how getting PDFs went", error))
    }, this.delayMs)
    this.timer.unref?.()
  }

  private write() {
    const file = this.file
    if (!file) return Promise.resolve()
    return this.writes.run(() => writeJsonAtomic(file, { version: 1, followUps: this.followUps, tally: Object.fromEntries(this.tally), resumed: Object.fromEntries(this.resumes), queued: Object.fromEntries(this.queue) } satisfies File))
  }

  private async load() {
    if (!this.file) return
    const kept = await readJson<File>(this.file).catch((error) => {
      console.error("[core] couldn't read how getting PDFs went; starting afresh", error)
      return undefined
    })
    if (kept?.version !== 1) return
    const old = Date.now() - FOLLOW_UP_MS
    for (const f of kept.followUps ?? []) {
      if (this.get(f.gate, f.since)) continue
      // A wait that went a day ago has nothing left to show
      if (!f.up && !(f.going && f.going.at > old)) continue
      this.followUps.push(f)
    }
    for (const [gate, at] of Object.entries(kept.resumed ?? {})) this.resumes.set(gate as GateKey, Math.max(at, this.resumes.get(gate as GateKey) ?? 0))
    for (const [id, q] of Object.entries(kept.queued ?? {})) if (!this.queueSet || !this.queue.has(id)) this.queue.set(id, q)
    for (const [gate, t] of Object.entries(kept.tally ?? {})) {
      const now = this.tally.get(gate as GateKey)
      if (!now) this.tally.set(gate as GateKey, { ...t, recent: t.recent.filter((r) => r > old) })
      else
        Object.assign(now, {
          handed: now.handed + t.handed,
          pdfs: now.pdfs + t.pdfs,
          endings: Object.fromEntries([...new Set([...Object.keys(now.endings), ...Object.keys(t.endings)])].map((k) => [k, (now.endings[k as WorkEnding] ?? 0) + (t.endings[k as WorkEnding] ?? 0)])),
          lastPdfAt: Math.max(now.lastPdfAt ?? 0, t.lastPdfAt ?? 0) || undefined,
          recent: [...t.recent.filter((r) => r > old), ...now.recent].slice(-RECENT_KEPT),
        })
    }
  }
}

// A line of papers going on, with more that went on at this time: one going on again counts from now
function goOnWith(going: Going, ids: string[], at: number): Going {
  const from = { ...going.from }
  for (const id of ids) from[id] = at
  return { at: going.at, ids: [...new Set([...going.ids, ...ids])], from }
}
