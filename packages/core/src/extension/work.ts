import type { ExtensionWait, GateKey, LaneKey, OpenPage, PdfState, ProxySettings, WorkAnswer, WorkEnding, WorkItem } from "@owlit/protocol"
import type { ExtensionFetcher, ExtensionPaper, Library } from "../library/library.ts"
import { hostOf } from "../net/http.ts"
import { gateOf, laneOf, watchOf } from "./keys.ts"
import { siteOf } from "./route.ts"

// The papers owlit hands to its browser extension once its own routes found no copy, and the pace it
// asks for them at. owlit decides what and when: per lane (the library proxy, which every paper through
// it shares, or else the paper's gate, keys.ts) one fetch at a time, the next a while after the last
// ended, so no publisher or proxy sees a burst from the user's browser. A fetch that stopped where only
// the user can get through (a check, a sign-in, the extension not allowed there) makes a wait at the gate
// it met, one per gate. A paper is under a wait when its gate is the wait's, or when its lane is (the
// proxy's own sign-in holds every paper through it); a lane passes over the papers under a wait, and each
// wait's papers go on at the one time the user gets through (or one of its occasional tries does).
//
// A paper's gate is the one its newest extension try met (PdfTry.gate), else the one its route predicts.
// The waits of a workspace are rebuilt from its papers' records when it opens (restore), so they are up
// before any extension connects; the queues are filled when one does.
//
// In memory only: when the extension connects (its first GET /work since owlit started, since it was
// last away, or since another workspace opened), the library hands over every paper waiting for it again
// (WorkHost.connected). A fetch handed to an extension that went away is asked for again when an
// extension asks for work next; while the one it went to keeps asking, it is still going.
//
// A work item's id is `<paperId>#<attempt>`: the attempt is one more than the extension tries the
// paper's record holds, so it is the same before and after a restart, and an answer is matched by the
// paper and that number, never by anything kept only in memory.

// Between two fetches at one site, from the end of the last. Through the proxy, longer: a campus shares
// one proxy, and it limits how often a reader may ask (Tsinghua's tlink's minute-limit page).
export const GAP_MS = 15_000
export const PROXY_GAP_MS = 30_000
// The extension counts as connected while it asked for work this recently; it asks again as soon as a
// hold of GET /work ends, and keeps asking while its fetches go on beside the hold. One that hasn't
// asked for this long is away, and so are its fetches still out (the browser closed, the machine slept,
// the service worker was stopped mid-fetch).
export const CONNECTED_MS = 60_000
// A fetch out this long goes back to its queue even while the extension it went to keeps asking. The
// reconnect rule (reissue) covers every way a fetch is lost that is known; this only keeps a site's
// queue from stopping for ever on one that isn't (an answer the extension never sends). Far beyond the
// extension's slowest answer: three gets of FETCH_MS (60 s) in apps/extension/src/lib/work.ts, then the
// upload.
export const STALLED_MS = 30 * 60_000
// A wait tries its first paper once more this long after it began: the user
// may have got through where the extension couldn't tell (signing in can end on a page that still looks
// like a sign-in, the proxy's own front page). Once only: a try every quarter of an hour for days wrote
// dozens of silent tries into a paper's record and told the user nothing. After it the wait is for
// the user to get through (resume), or to ask for one of its papers (fetch with askedFor).
export const PAUSED_RETRY_MS = 15 * 60_000
// After a fetch in a lane reached nothing (the network dropped, the proxy's minute-limit page), the lane
// waits this long before its next, longer each time in a row: the paper keeps its place, since nothing
// was learnt about it, and a limit that counts every request isn't asked again within the minute
export const OFFLINE_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000]

export interface WorkOptions {
  gapMs?: number
  proxyGapMs?: number
}

interface Queued {
  paper: ExtensionPaper
  // The user pressed Find PDF or Look again on it in this session
  askedFor: boolean
  // The extension's tries the paper's record holds: its next hand-out is attempt tries + 1
  tries: number
  // Its gate now (the newest try's, else predicted), and the one its route predicts
  gate: GateKey
  predicted: GateKey
}

interface Lane {
  key: LaneKey
  proxied: boolean
  queue: Queued[]
  // by: the pairing it was handed to
  inFlight?: { id: string; item: Queued; at: number; by?: string }
  // When its last fetch ended, for the gap before the next
  endedAt?: number
  // Its fetches reached nothing this many times in a row; none goes out before until
  offline?: { times: number; until: number }
}

interface Wait {
  gate: GateKey
  kind: ExtensionWait["kind"]
  // ExtensionWait.at, .url, .watch
  at: string
  url: string
  watch: string[]
  // When its one try on owlit's own goes (PAUSED_RETRY_MS after it began); absent once it ran
  tryAt?: number
  // The pairing whose fetch met it: its browser is the one where the user gets through
  by?: string
  // Papers whose records say they met it, not in a queue yet (the extension hasn't connected since the
  // workspace opened): paper id → the extension's tries its record holds
  known: Map<string, number>
}

// A wait a paper's record says it met, as the library reads it when a workspace opens
export interface KnownWait {
  paperId: string
  kind: ExtensionWait["kind"]
  gate: GateKey
  // The page the try ended on, else one that leads to the same place (the DOI's link)
  url: string
  host?: string
  tries: number
}

const PAUSES: Partial<Record<WorkEnding, ExtensionWait["kind"]>> = { check: "check", blocked: "blocked", "sign-in": "sign-in", "no-permission": "permission" }

export interface WorkHost {
  // These papers' standing changed (queued, under a wait, left the queue): the window hears them again
  papers: (library: Library, ids: string[]) => void
  // The waits changed
  waits: () => void
  // An extension began asking for work for this library, with nothing of it queued yet or not for a
  // while: the library hands over what waits for the extension
  connected: (library: Library) => void
}

export class ExtensionWork implements ExtensionFetcher {
  private readonly host: WorkHost
  private readonly options: Required<WorkOptions>
  // The workspace's library the queues and waits belong to; another workspace opening starts them afresh
  private library: Library | null = null
  // The library an extension was last counted as arriving at (WorkHost.connected): not the same as the
  // one owned, which a background look in a reopened workspace takes over before the extension asks
  private connectedTo: Library | null = null
  private readonly lanes = new Map<LaneKey, Lane>()
  private readonly waitsAt = new Map<GateKey, Wait>()
  // When the last fetch ended in a lane whose queue has since emptied: a paper arriving there after it
  // still waits for the gap, so papers that come one at a time (an import's lookups finishing seconds
  // apart) aren't fetched in a burst
  private readonly lastEnded = new Map<LaneKey, number>()
  // Each pairing's GET /work (by its id; "" for a caller that names none): how many are being held now,
  // when the last ended, and whether the extension closed it while held (its service worker stopped)
  private readonly asks = new Map<string, { open: number; at: number; dropped: boolean }>()
  private polledAt = Number.NEGATIVE_INFINITY
  // When each pairing last asked for work
  private readonly polled = new Map<string, number>()
  // Pages to open, per pairing, until its next GET /work collects them
  private readonly opens = new Map<string, OpenPage[]>()
  private readonly waiters = new Set<() => void>()

  constructor(host: WorkHost, options: WorkOptions = {}) {
    this.host = host
    this.options = { gapMs: options.gapMs ?? GAP_MS, proxyGapMs: options.proxyGapMs ?? PROXY_GAP_MS }
  }

  connected() {
    return Date.now() - this.polledAt < CONNECTED_MS
  }

  // The pairings asking for work now, the most recent first
  connectedPairings(): string[] {
    const now = Date.now()
    return [...this.polled].filter(([, at]) => now - at < CONNECTED_MS).sort((a, b) => b[1] - a[1]).map(([by]) => by)
  }

  // The user asked to open what a wait needs: handed to the extension whose fetch met it, or, when that
  // one isn't asking now, to the one that asked last. The pairing it went to; undefined when no wait
  // there is of that kind or no extension is connected.
  open(kind: ExtensionWait["kind"], host: string): string | undefined {
    const wait = this.waitNamed(host)
    if (!wait || wait.kind !== kind || !this.count(wait)) return undefined
    const connected = this.connectedPairings()
    const by = wait.by && connected.includes(wait.by) ? wait.by : connected[0]
    if (!by) return undefined
    const page: OpenPage = kind === "permission" ? { kind, host, papers: this.count(wait) } : { kind, host, url: wait.url }
    // Pressed twice before the extension collected it: opened once
    this.openFor(by, page, (o) => "host" in o && o.host === host)
    return by
  }

  // A page for this pairing's extension to open, collected by its next GET /work, which it ends at once.
  // replaces: the pages not collected yet that this one stands in for; a walk replaces any walk.
  openFor(by: string, page: OpenPage, replaces: (pending: OpenPage) => boolean = (o) => o.kind === "walk" && page.kind === "walk") {
    this.opens.set(by, [...(this.opens.get(by) ?? []).filter((o) => !replaces(o)), page])
    this.kick()
  }

  // The pairing whose fetch met the wait shown at this host
  pausedBy(host: string): string | undefined {
    return this.waitNamed(host)?.by
  }

  // The pages waiting for this pairing, handed over once
  takeOpens(by: string | undefined): OpenPage[] {
    if (!by) return []
    const pages = this.opens.get(by) ?? []
    this.opens.delete(by)
    return pages
  }

  // The waits a workspace's papers' records say they met (Library.restoreWaits), up as it opens, before
  // any extension connects; their papers join the queues once one does. Each wait's one try goes as
  // soon as a paper of it is queued: the user may have got through since owlit last ran.
  restore(library: Library, known: KnownWait[], proxy: ProxySettings | undefined) {
    this.own(library)
    const now = Date.now()
    for (const k of known) {
      if (this.holds(k.paperId)) continue
      let wait = this.waitsAt.get(k.gate)
      if (!wait) {
        const at = atOf(k.gate, k.kind, k.host)
        const lane: LaneKey = k.gate.startsWith("proxy:") ? k.gate : proxy ? `proxy:${hostOf(proxy.base).toLowerCase()}` : k.gate
        wait = { gate: k.gate, kind: k.kind, at, url: k.url, watch: watchOf(k.gate, lane, proxy), tryAt: now, known: new Map() }
        this.waitsAt.set(k.gate, wait)
      }
      wait.known.set(k.paperId, k.tries)
    }
    this.host.waits()
  }

  // A paper for the extension to fetch. One already queued keeps its place, and is marked as asked for
  // when the user asked now; asked for, it goes before the ones that weren't, and the wait it is under is
  // lifted, since the user may have got through already.
  fetch(library: Library, paper: ExtensionPaper, askedFor: boolean) {
    this.own(library)
    const proxy = paper.proxied ? paper.proxy : undefined
    const predicted = paper.predicted ?? gateOf(paper.url, proxy)
    const gate = paper.gate ?? predicted
    const laneKey = laneOf(paper)
    // A paper whose lane changed since it was queued (the proxy set or cleared) moves to its new one
    for (const lane of this.lanes.values()) {
      if (lane.key === laneKey) continue
      const at = lane.queue.findIndex((q) => q.paper.paperId === paper.paperId)
      if (at >= 0) lane.queue.splice(at, 1)
    }
    let known = 0
    for (const wait of this.waitsAt.values()) {
      known = Math.max(known, wait.known.get(paper.paperId) ?? 0)
      wait.known.delete(paper.paperId)
    }
    let lane = this.lanes.get(laneKey)
    if (!lane) {
      lane = { key: laneKey, proxied: paper.proxied, queue: [], endedAt: this.lastEnded.get(laneKey) }
      this.lanes.set(laneKey, lane)
    }
    lane.proxied = paper.proxied
    let item: Queued
    if (lane.inFlight?.item.paper.paperId === paper.paperId) {
      item = lane.inFlight.item
      item.askedFor ||= askedFor
    } else {
      const queued = lane.queue.find((q) => q.paper.paperId === paper.paperId)
      if (queued) {
        item = queued
        Object.assign(queued, { paper, gate, predicted })
        queued.askedFor ||= askedFor
        // The record may lag a try settled in memory whose note is still being written
        queued.tries = Math.max(queued.tries, paper.tries ?? 0, known)
      } else {
        item = { paper, askedFor, tries: Math.max(paper.tries ?? 0, known), gate, predicted }
        lane.queue.push(item)
      }
      sortQueue(lane)
    }
    const over = askedFor ? this.waitOver(lane, item) : undefined
    const lifted = over ? this.papersUnder(over) : []
    if (over) this.waitsAt.delete(over.gate)
    this.host.papers(library, [...new Set([paper.paperId, ...lifted])])
    this.host.waits()
    this.kick()
  }

  // Where the paper stands with the extension, while it has it, or while a wait holds it from its record
  holding(library: Library, id: string): PdfState["extension"] | undefined {
    if (library !== this.library) return undefined
    for (const lane of this.lanes.values()) {
      const item = lane.inFlight?.item.paper.paperId === id ? lane.inFlight.item : lane.queue.find((q) => q.paper.paperId === id)
      if (!item) continue
      const base = { lane: lane.key, gate: item.gate, attempt: item.tries + 1, host: item.paper.host, ...(lane.proxied ? { proxied: true } : {}) }
      if (lane.inFlight?.item === item) return { ...base, fetching: true }
      const wait = this.waitOver(lane, item)
      return wait ? { ...base, ...underWait(wait) } : base
    }
    for (const wait of this.waitsAt.values()) {
      const tries = wait.known.get(id)
      if (tries === undefined) continue
      return { lane: wait.gate, gate: wait.gate, attempt: tries + 1, host: wait.at, ...(wait.gate.startsWith("proxy:") ? { proxied: true } : {}), ...underWait(wait) }
    }
    return undefined
  }

  inQueue(library: Library, id: string): boolean {
    return library === this.library && this.holds(id)
  }

  // How many papers the queues hold, the ones out for a try included
  queued(library: Library): number {
    if (library !== this.library) return 0
    return [...this.lanes.values()].reduce((n, lane) => n + all(lane).length, 0)
  }

  // GET /work: the papers due now, held for up to holdMs while none is. Each one is in flight until its
  // answer comes (settle), or until an extension asks for work while the one it went to is away.
  async take(library: Library | null, holdMs: number, closed: AbortSignal, by?: string): Promise<WorkItem[]> {
    // Away for longer than counts as connected, or never here for this library: papers the plain routes
    // missed meanwhile went to no queue, and after a restart the queues are empty, so the library fills
    // them before anything is due. Marked connected first, so what the library hands over is queued, not
    // left with no PDF.
    const arrived = !this.connected() || library !== this.connectedTo
    // Before this ask is counted: the asker's own fetches from before it was away go out again too
    this.reissue()
    const ask = this.asks.get(by ?? "") ?? { open: 0, at: 0, dropped: false }
    ask.open++
    this.asks.set(by ?? "", ask)
    this.polledAt = Date.now()
    if (by) this.polled.set(by, this.polledAt)
    if (library !== this.library) this.own(library)
    this.connectedTo = library
    if (arrived && library) this.host.connected(library)
    const until = Date.now() + holdMs
    for (;;) {
      const due = this.due(by)
      const left = until - Date.now()
      // A page to open ends the hold too: the user is waiting for it
      if (due.length || left <= 0 || closed.aborted || (by && this.opens.get(by)?.length)) {
        this.polledAt = Date.now()
        if (by) this.polled.set(by, this.polledAt)
        ask.open--
        ask.at = this.polledAt
        ask.dropped = closed.aborted
        return due
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          this.waiters.delete(done)
          closed.removeEventListener("abort", done)
          resolve()
        }
        const timer = setTimeout(done, Math.min(left, this.nextDueIn()))
        this.waiters.add(done)
        closed.addEventListener("abort", done, { once: true })
      })
    }
  }

  // The paper a work item's id is out for, while that attempt is the one in flight in this library:
  // undefined for an attempt that ended or was handed out again under a newer one, and for one from
  // another workspace's queue
  current(library: Library, id: string): ExtensionPaper | undefined {
    if (library !== this.library) return undefined
    return this.flying(id)?.inFlight?.item.paper
  }

  // The gate the answer to the attempt in flight met, as its try notes it (PdfTry.gate); undefined when
  // the attempt isn't the one in flight
  gateFor(id: string, page: { url?: string; host?: string }): GateKey | undefined {
    const lane = this.flying(id)
    return lane?.inFlight ? answerGate(lane.inFlight.item, page) : undefined
  }

  // The extension's answer, once core has noted it: a PDF (ended undefined) or a word. A word that only
  // the user can get past makes, or adds to, the wait at the gate the page belongs to, its paper first in
  // line for when they have. Not the attempt in flight: nothing changes.
  settle(id: string, ended: WorkEnding | undefined, page: { url?: string; host?: string } = {}) {
    const lane = this.flying(id)
    if (!lane?.inFlight || !this.library) return
    const { item, by } = lane.inFlight
    lane.inFlight = undefined
    // The answer was noted as one more try in the paper's record
    item.tries++
    const now = Date.now()
    lane.endedAt = now
    const was = this.waitOver(lane, item)
    const pause = ended && PAUSES[ended]
    if (ended === "offline") {
      // Its try reached nothing: a wait it was under keeps waiting, its one try still to come
      if (was) was.tryAt = now + PAUSED_RETRY_MS
      else {
        const times = (lane.offline?.times ?? 0) + 1
        lane.offline = { times, until: now + OFFLINE_BACKOFF_MS[Math.min(times, OFFLINE_BACKOFF_MS.length) - 1] }
      }
      lane.queue.unshift(item)
      sortQueue(lane)
      this.host.papers(this.library, [item.paper.paperId])
    } else if (pause) {
      lane.offline = undefined
      item.gate = answerGate(item, page)
      lane.queue.unshift(item)
      sortQueue(lane)
      const pageHost = page.url ? hostOf(page.url) : page.host
      const at = atOf(item.gate, pause, pageHost)
      // The library's sign-in page for the proxy's own sign-in; the publisher's page for one met there
      const url = (pause === "sign-in" && item.gate.startsWith("proxy:") && item.paper.signIn) || page.url || item.paper.url
      const before = this.waitsAt.get(item.gate)
      const proxy = item.paper.proxied ? item.paper.proxy : undefined
      // Met again (by its one try on owlit's own, or another paper of it): no more tries until the user
      // acts. A wait it was under elsewhere had its try too.
      const wait: Wait = { gate: item.gate, kind: pause, at, url, watch: watchOf(item.gate, lane.key, proxy), by, known: before?.known ?? new Map(), ...(before ? {} : { tryAt: now + PAUSED_RETRY_MS }) }
      this.waitsAt.set(item.gate, wait)
      if (was && was !== before) was.tryAt = undefined
      this.host.papers(this.library, [...new Set([item.paper.paperId, ...this.papersUnder(wait), ...(was ? this.papersUnder(was) : [])])])
      this.host.waits()
    } else {
      lane.offline = undefined
      const freed = was ? this.papersUnder(was) : []
      // A try under a wait got through: the user did, somewhere the extension didn't see
      if (was) {
        this.waitsAt.delete(was.gate)
        this.host.waits()
      }
      this.leaveIfEmpty(lane)
      this.host.papers(this.library, [...new Set([item.paper.paperId, ...freed])])
    }
    this.kick()
  }

  // POST /work/resume: the user got through at this host. Every wait it names (its at, a host it
  // watches, or under the same registrable domain) goes, its papers on at once, the asked for first.
  resume(host: string): boolean {
    const gone = [...this.waitsAt.values()].filter((w) => names(w, host))
    if (!gone.length) return false
    const freed = gone.flatMap((w) => this.papersUnder(w))
    const known = gone.some((w) => w.known.size)
    for (const w of gone) this.waitsAt.delete(w.gate)
    for (const lane of this.lanes.values()) {
      if (lane.queue.some((q) => freed.includes(q.paper.paperId))) lane.endedAt = undefined
    }
    if (this.library) {
      this.host.papers(this.library, freed)
      // Papers known only from their records go to the queues now
      if (known) this.host.connected(this.library)
    }
    this.host.waits()
    this.kick()
    return true
  }

  // POST /work/blocked: the user's browser met a block at this host where a wait is for a check or a
  // sign-in (the fetch read the block as one, or the block came after). Matched as resume matches; the
  // wait stays, without another try, and says what is in the way now.
  blocked(host: string, url: string): boolean {
    let any = false
    for (const wait of this.waitsAt.values()) {
      if (!names(wait, host) || (wait.kind !== "check" && wait.kind !== "sign-in")) continue
      wait.kind = "blocked"
      wait.url = url
      if (!wait.gate.startsWith("proxy:")) wait.at = atOf(wait.gate, "blocked", hostOf(url))
      wait.tryAt = undefined
      any = true
      if (this.library) this.host.papers(this.library, this.papersUnder(wait))
    }
    if (any) this.host.waits()
    return any
  }

  // A paper that no longer wants fetching (its PDF was placed another way, it went to the trash or was
  // folded into another, the user stopped it): out of its queue, and out of the count of the wait it was
  // under; a wait with no paper left goes. One in flight is left to its answer, which finds the paper
  // gone or with its PDF.
  drop(library: Library, id: string) {
    if (library !== this.library) return
    let waitsChanged = false
    for (const wait of this.waitsAt.values()) if (wait.known.delete(id)) waitsChanged = true
    for (const lane of [...this.lanes.values()]) {
      const at = lane.queue.findIndex((q) => q.paper.paperId === id)
      if (at < 0) continue
      const [item] = lane.queue.splice(at, 1)
      if (this.waitOver(lane, item)) waitsChanged = true
      this.leaveIfEmpty(lane)
    }
    if (!waitsChanged) return
    for (const wait of [...this.waitsAt.values()]) if (!this.count(wait)) this.waitsAt.delete(wait.gate)
    this.host.waits()
  }

  // The waits, as the window shows them; a paper out for a try still waits there
  waits(): ExtensionWait[] {
    return [...this.waitsAt.values()].flatMap((wait) => {
      const papers = this.count(wait)
      if (!papers) return []
      const askedFor = this.itemsUnder(wait).some((q) => q.askedFor)
      return [{ id: wait.gate, kind: wait.kind, at: wait.at, host: wait.at, watch: wait.watch, papers, url: wait.url, askedFor, proxied: wait.gate.startsWith("proxy:") }]
    })
  }

  // The same for the extension, which watches those sites for the user getting through
  waitsForExtension(): WorkAnswer["waits"] {
    return this.waits().map(({ id, kind, at, host, watch, papers, proxied }) => ({ id, kind, at, host, watch, papers, proxied }))
  }

  dispose() {
    for (const waiter of [...this.waiters]) waiter()
  }

  private own(library: Library | null) {
    if (library === this.library) return
    this.library = library
    this.lanes.clear()
    this.waitsAt.clear()
    this.lastEnded.clear()
    this.opens.clear()
    this.host.waits()
  }

  private holds(id: string) {
    return [...this.lanes.values()].some((lane) => all(lane).some((q) => q.paper.paperId === id))
  }

  // The wait a paper is under: its lane's own (the proxy's sign-in holds every paper through it), else
  // its gate's
  private waitOver(lane: Lane, item: Queued): Wait | undefined {
    return this.waitsAt.get(lane.key) ?? this.waitsAt.get(item.gate)
  }

  private itemsUnder(wait: Wait): Queued[] {
    return [...this.lanes.values()].flatMap((lane) => all(lane).filter((q) => this.waitOver(lane, q) === wait))
  }

  private papersUnder(wait: Wait): string[] {
    return [...this.itemsUnder(wait).map((q) => q.paper.paperId), ...wait.known.keys()]
  }

  private count(wait: Wait) {
    return this.papersUnder(wait).length
  }

  // The wait shown at this host (ExtensionWait.at)
  private waitNamed(host: string): Wait | undefined {
    return [...this.waitsAt.values()].find((w) => w.at === host)
  }

  private leaveIfEmpty(lane: Lane) {
    if (lane.queue.length || lane.inFlight) return
    this.lanes.delete(lane.key)
    if (lane.endedAt !== undefined) this.lastEnded.set(lane.key, lane.endedAt)
  }

  private gap(lane: Lane) {
    return lane.proxied ? this.options.proxyGapMs : this.options.gapMs
  }

  // When the lane's next fetch may go out: after the gap and after an offline back-off
  private paceAt(lane: Lane) {
    return Math.max(lane.endedAt === undefined ? 0 : lane.endedAt + this.gap(lane), lane.offline?.until ?? 0)
  }

  // The lane's next paper, and when it may go: the first not under a wait at once, else the first under a
  // wait whose one try is due (and no paper of that wait is out already)
  private next(lane: Lane): { item: Queued; at: number; wait?: Wait } | undefined {
    let best: { item: Queued; at: number; wait?: Wait } | undefined
    const trying = new Set([...this.lanes.values()].flatMap((l) => (l.inFlight ? [this.waitOver(l, l.inFlight.item)] : [])))
    for (const item of lane.queue) {
      const wait = this.waitOver(lane, item)
      if (!wait) return { item, at: 0 }
      if (wait.tryAt === undefined || trying.has(wait)) continue
      if (!best || wait.tryAt < best.at) best = { item, at: wait.tryAt, wait }
    }
    return best
  }

  private due(by: string | undefined): WorkItem[] {
    const now = Date.now()
    const out: WorkItem[] = []
    for (const lane of this.lanes.values()) {
      if (lane.inFlight || !lane.queue.length || now < this.paceAt(lane)) continue
      const next = this.next(lane)
      if (!next || now < next.at) continue
      // Its one try is out
      if (next.wait) next.wait.tryAt = undefined
      lane.queue.splice(lane.queue.indexOf(next.item), 1)
      const id = workItemId(next.item.paper.paperId, next.item.tries + 1)
      lane.inFlight = { id, item: next.item, at: now, by }
      const { paperId, url, pdfUrl, host, proxied } = next.item.paper
      out.push({ id, paperId, url, ...(pdfUrl ? { pdfUrl } : {}), host, proxied })
    }
    return out
  }

  // The lane whose fetch in flight is this attempt
  private flying(id: string): Lane | undefined {
    return [...this.lanes.values()].find((lane) => lane.inFlight?.id === id)
  }

  // Fetches out with an extension that is away go back to the head of their queue, under the same
  // attempt: nothing was noted for them, and the late answer of the first hand-out still counts. An
  // extension is away when it hasn't asked for work for CONNECTED_MS, or closed its last ask while it was
  // held, and none of its asks is being held now; while one is, its fetches are going on beside it, so a
  // proxy never has two requests of the user's out at once. A fetch out STALLED_MS goes back whatever.
  private reissue() {
    const now = Date.now()
    for (const lane of this.lanes.values()) {
      if (!lane.inFlight) continue
      const ask = this.asks.get(lane.inFlight.by ?? "")
      const going = ask && (ask.open > 0 || (!ask.dropped && now - ask.at < CONNECTED_MS))
      if (going && now - lane.inFlight.at < STALLED_MS) continue
      lane.queue.unshift(lane.inFlight.item)
      lane.inFlight = undefined
      sortQueue(lane)
      lane.endedAt = now
    }
  }

  // How long until the next lane is due
  private nextDueIn() {
    const now = Date.now()
    let next = Number.POSITIVE_INFINITY
    for (const lane of this.lanes.values()) {
      if (lane.inFlight || !lane.queue.length) continue
      const paper = this.next(lane)
      if (paper) next = Math.min(next, Math.max(this.paceAt(lane), paper.at) - now)
    }
    return Math.max(0, next)
  }

  private kick() {
    for (const waiter of [...this.waiters]) waiter()
  }
}

// What one try in flight, or out of it, is
const all = (lane: Lane) => (lane.inFlight ? [lane.inFlight.item, ...lane.queue] : lane.queue)

// A paper's standing under a wait, as PdfState.extension says it
const underWait = (wait: Wait) => {
  const own = wait.gate.startsWith("proxy:")
  return { wait: wait.gate, kind: wait.kind, at: wait.at, waits: wait.kind, ...(own ? {} : { waitsAt: wait.at }) }
}

// The wait is named by this host: shown there, watching it, or under the same registrable domain
const names = (wait: Wait, host: string) => wait.at === host || siteOf(wait.at) === siteOf(host) || wait.watch.some((h) => host === h || host.endsWith(`.${h}`))

// The gate an answer met: the page it ended on, else the host it names. The extension names the paper's
// own site when it may not read the paper's page, which is the predicted gate's. A page a fetch ended on
// at a login-url proxy's own host is the proxy's, whatever its ?url= says: the proxy sends a reader it
// lets through on to the publisher's host, and keeps the target in the address of its sign-in.
function answerGate(item: Queued, page: { url?: string; host?: string }): GateKey {
  const proxy = item.paper.proxied ? item.paper.proxy : undefined
  const pageHost = (page.url ? hostOf(page.url) : page.host)?.toLowerCase()
  if (proxy?.scheme === "login-url" && pageHost === hostOf(proxy.base).toLowerCase()) return `proxy:${pageHost}`
  if (page.url) return gateOf(page.url, proxy, item.predicted)
  if (!page.host) return item.gate
  if (!item.paper.proxied && page.host === item.paper.host) return item.predicted
  return gateOf(`https://${page.host}/`, proxy, item.predicted)
}

// Where the user acts on a wait, as shown (ExtensionWait.at): the proxy's host for its own gate; the
// whole site to allow for a permission (one Allow covers doi.apa.org and psycnet.apa.org); the page's
// host when the page is the gate's own; else the gate's own name, so an identity provider or a CDN the
// page was on is never shown
function atOf(gate: GateKey, kind: ExtensionWait["kind"], pageHost: string | undefined): string {
  if (gate.startsWith("proxy:")) return gate.slice("proxy:".length)
  const host = pageHost?.toLowerCase()
  if (host && kind === "permission") return siteOf(host)
  if (host && gateOf(`https://${host}/`) === gate) return host.replace(/^www\./, "")
  return gate.startsWith("site:") ? gate.slice("site:".length) : (watchOf(gate, gate)[0] ?? gate.slice("pub:".length))
}

// The papers the user asked for first, each group in the order it came
const sortQueue = (lane: Lane) => {
  lane.queue = [...lane.queue.filter((q) => q.askedFor), ...lane.queue.filter((q) => !q.askedFor)]
}

// A work item's id, and back: the paper and its attempt (WorkItem.id). An id of another shape (from an
// owlit that handed out random ids) names no attempt, so its answer is owlit's no longer.
export const workItemId = (paperId: string, attempt: number) => `${paperId}#${attempt}`
export function parseWorkItemId(id: string): { paperId: string; attempt: number } | undefined {
  const at = id.lastIndexOf("#")
  const attempt = Number(id.slice(at + 1))
  if (at <= 0 || !Number.isInteger(attempt) || attempt < 1) return undefined
  return { paperId: id.slice(0, at), attempt }
}
