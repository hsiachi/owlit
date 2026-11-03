import type { ExtensionWait, GateKey, LaneKey, OpenPage, PdfState, ProxySettings, WaitId, WorkAnswer, WorkEnding, WorkItem } from "@owlit/protocol"
import type { ExtensionFetcher, ExtensionPaper, Library } from "../library/library.ts"
import { hostOf } from "../net/http.ts"
import { allowOf, gateOf, laneOf, tabOnly, watchOf } from "./keys.ts"
import { FOLLOW_UP_MS, PdfWorkNotes, type FollowUp } from "./pdf-work.ts"
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
//
// What the records can't say is kept per workspace on this machine (pdf-work.ts): each wait's
// follow-ups (its page opened, the user saying they got through, the papers that went on then), by gate
// and since, and a tally per gate of what was handed out and how it ended.

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
// After a fetch reached nothing (the network dropped, a publisher's host doesn't resolve, the proxy's
// minute-limit page), what didn't answer waits this long before its next, longer each time in a row: the
// paper keeps its place, since nothing was learnt about it, and a limit that counts every request isn't
// asked again within the minute. What waits is the gate whose site didn't answer, and the lane goes on
// with its other gates; only the proxy not answering (its own host, its sign-in's) holds the whole lane.
export const OFFLINE_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000]

export interface WorkOptions {
  gapMs?: number
  proxyGapMs?: number
  // Say in the log when a gate gives nothing without a wait to explain it (silentZeros): a build run
  // from a checkout, where someone reads the log
  warnSilentZeros?: boolean
}

interface Queued {
  paper: ExtensionPaper
  // The user pressed Find PDF or Look again on it in this session
  askedFor: boolean
  // Its next fetch is part of something the user started: they asked for it (askedFor), or got through
  // at the wait it was under. Over once a fetch of it ends, so a wait's later try on owlit's own, or a
  // paper handed over again in the background, never opens a tab in the user's browser (WorkItem.userStarted).
  started: boolean
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
  // The proxy reached nothing this many times in a row; none of the lane's fetches goes out before until.
  // at: the host that didn't answer, as said.
  offline?: Offline
  // The same per gate in the lane, for a publisher that didn't answer: its papers wait, the others go on
  gatesOffline: Map<GateKey, Offline>
}

interface Offline {
  times: number
  until: number
  at: string
}

interface Wait {
  gate: GateKey
  // When it began, kept while it is met again; a wait that came back after the user got through (a
  // paper that went on met the same gate) keeps the first one's
  since: number
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
  // When that try was
  triedAt: number
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
  // The owned library's notes on this machine (pdf-work.json)
  private notes = new PdfWorkNotes(undefined)
  // When each gate was last said to give nothing, so the log says it once a day
  private readonly warned = new Map<GateKey, number>()
  // Papers freed by the user getting through at a wait that weren't in a queue then (known only from
  // their records): they go out as part of what the user started once the library hands them over
  private readonly startedIds = new Set<string>()

  constructor(host: WorkHost, options: WorkOptions = {}) {
    this.host = host
    this.options = { gapMs: options.gapMs ?? GAP_MS, proxyGapMs: options.proxyGapMs ?? PROXY_GAP_MS, warnSilentZeros: options.warnSilentZeros ?? false }
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
  // one isn't asking now, to the one that asked last. The pairing it went to; undefined when no such
  // wait is up or no extension is connected.
  open(id: WaitId): string | undefined {
    const wait = this.waitsAt.get(id)
    if (!wait || !this.count(wait)) return undefined
    const connected = this.connectedPairings()
    const by = wait.by && connected.includes(wait.by) ? wait.by : connected[0]
    if (!by) return undefined
    const { kind, at: host } = wait
    const page: OpenPage = kind === "permission" ? { kind, host, papers: this.count(wait) } : { kind, host, url: wait.url }
    // Pressed twice before the extension collected it: opened once
    this.openFor(by, page, (o) => "host" in o && o.host === host)
    return by
  }

  // The wait's page was opened in the user's browser (by its extension, or by owlit there): its button
  // now says what they did there, and an earlier "still asks you" is over
  opened(id: WaitId, browser: string | undefined) {
    const wait = this.waitsAt.get(id)
    if (!wait) return
    const follow = this.notes.of(wait)
    follow.opened = { at: Date.now(), ...(browser ? { browser } : {}) }
    follow.retried = undefined
    this.notes.changed()
    this.host.waits()
  }

  // A page for this pairing's extension to open, collected by its next GET /work, which it ends at once.
  // replaces: the pages not collected yet that this one stands in for; a walk replaces any walk.
  openFor(by: string, page: OpenPage, replaces: (pending: OpenPage) => boolean = (o) => o.kind === "walk" && page.kind === "walk") {
    this.opens.set(by, [...(this.opens.get(by) ?? []).filter((o) => !replaces(o)), page])
    this.kick()
  }

  // The pairing whose fetch met the wait
  pausedBy(id: WaitId): string | undefined {
    return this.waitsAt.get(id)?.by
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
  // soon as a paper of it is queued: the user may have got through since owlit last ran. A wait that was
  // up when owlit last ran takes its since back, and with it its follow-ups.
  async restore(library: Library, known: KnownWait[], proxy: ProxySettings | undefined) {
    this.own(library)
    const notes = this.notes
    await notes.loaded
    // Another workspace opened meanwhile
    if (notes !== this.notes) return
    const now = Date.now()
    const made = new Set<Wait>()
    for (const k of known) {
      if (this.holds(k.paperId)) continue
      // The user got through there after this try, with no extension to go on then: the paper waits for
      // the browser, not for them
      if (k.triedAt <= (notes.resumedAt(k.gate) ?? Number.NEGATIVE_INFINITY)) continue
      let wait = this.waitsAt.get(k.gate)
      if (!wait) {
        const at = atOf(k.gate, k.kind, k.host)
        const lane: LaneKey = k.gate.startsWith("proxy:") ? k.gate : proxy ? `proxy:${hostOf(proxy.base).toLowerCase()}` : k.gate
        wait = { gate: k.gate, since: k.triedAt, kind: k.kind, at, url: k.url, watch: watchOf(k.gate, lane, proxy), tryAt: now, known: new Map() }
        this.waitsAt.set(k.gate, wait)
        made.add(wait)
      }
      // Begun by the earliest try that met it
      if (made.has(wait)) wait.since = Math.min(wait.since, k.triedAt)
      wait.known.set(k.paperId, k.tries)
    }
    for (const wait of made) {
      const was = notes.upAt(wait.gate)
      // The same wait when it began no later than its papers' tries say; one up at the gate since is a
      // later wait's, and the tries an earlier one's
      if (was && was.since <= wait.since) wait.since = was.since
      notes.of(wait)
    }
    notes.keepUp((f) => this.waitsAt.get(f.gate)?.since === f.since)
    this.host.waits()
  }

  // A paper for the extension to fetch. One already queued keeps its place, and is marked as asked for
  // when the user asked now; asked for, it goes before the ones that weren't, and the wait it is under is
  // tried at once, since the user may have got through already.
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
      lane = { key: laneKey, proxied: paper.proxied, queue: [], endedAt: this.lastEnded.get(laneKey), gatesOffline: new Map() }
      this.lanes.set(laneKey, lane)
    }
    lane.proxied = paper.proxied
    let item: Queued
    if (lane.inFlight?.item.paper.paperId === paper.paperId) {
      item = lane.inFlight.item
      item.askedFor ||= askedFor
      item.started ||= askedFor
    } else {
      const queued = lane.queue.find((q) => q.paper.paperId === paper.paperId)
      if (queued) {
        item = queued
        Object.assign(queued, { paper, gate, predicted })
        queued.askedFor ||= askedFor
        queued.started ||= askedFor || this.startedIds.has(paper.paperId)
        // The record may lag a try settled in memory whose note is still being written
        queued.tries = Math.max(queued.tries, paper.tries ?? 0, known)
      } else {
        item = { paper, askedFor, started: askedFor || this.startedIds.has(paper.paperId), tries: Math.max(paper.tries ?? 0, known), gate, predicted }
        lane.queue.push(item)
      }
      sortQueue(lane)
    }
    this.startedIds.delete(paper.paperId)
    // Asked for under a wait: the wait stays, with what the user did about it (its page opened, "I've
    // verified it"), since they may be in front of its page now; its one try goes now, with this paper.
    // A try that gets through lifts it; one that meets it again leaves it as it was.
    const over = askedFor ? this.waitOver(lane, item) : undefined
    if (over) over.tryAt = Date.now()
    this.host.papers(library, [paper.paperId])
    this.host.waits()
    this.kick()
  }

  // Where the paper stands with the extension, while it has it, or while a wait holds it from its record
  holding(library: Library, id: string): PdfState["extension"] | undefined {
    if (library !== this.library) return undefined
    for (const lane of this.lanes.values()) {
      const item = lane.inFlight?.item.paper.paperId === id ? lane.inFlight.item : lane.queue.find((q) => q.paper.paperId === id)
      if (!item) continue
      const base = { lane: lane.key, gate: item.gate, attempt: item.tries + 1, at: item.paper.host }
      if (lane.inFlight?.item === item) return { ...base, fetching: true }
      const wait = this.waitOver(lane, item)
      if (wait) return { ...base, ...underWait(wait) }
      const off = offlineOf(lane, item.gate)
      return off ? { ...base, unreachable: { at: off.at, until: off.until } } : base
    }
    for (const wait of this.waitsAt.values()) {
      const tries = wait.known.get(id)
      if (tries === undefined) continue
      return { lane: wait.gate, gate: wait.gate, attempt: tries + 1, ...underWait(wait) }
    }
    return undefined
  }

  runsChanged(library: Library) {
    if (library === this.library) this.host.waits()
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

  // The extension's answer, once core has noted it: "pdf" when its PDF was placed, a word, or undefined
  // when there is nothing to fetch any more (the paper went, or has its PDF). A word that only the user
  // can get past makes, or adds to, the wait at the gate the page belongs to, its paper first in line
  // for when they have. Not the attempt in flight: nothing changes.
  // triedAt: when the try was noted, which a wait it makes begins at, so a restart that rebuilds the
  // wait from the try finds its follow-ups (restore).
  settle(id: string, ended: WorkEnding | "pdf" | undefined, page: { url?: string; host?: string; triedAt?: number } = {}) {
    const lane = this.flying(id)
    if (!lane?.inFlight || !this.library) return
    const { item, by } = lane.inFlight
    lane.inFlight = undefined
    // The answer was noted as one more try in the paper's record
    item.tries++
    // A try that reached nothing goes again as part of the same thing
    if (ended !== "offline") item.started = false
    const now = Date.now()
    lane.endedAt = now
    const was = this.waitOver(lane, item)
    const pause = ended && ended !== "pdf" ? PAUSES[ended] : undefined
    if (ended === "pdf") this.notes.pdf(item.gate, now)
    if (ended === "offline") {
      // Its try reached nothing: a wait it was under keeps waiting, its one try still to come
      if (was) was.tryAt = now + PAUSED_RETRY_MS
      else {
        const host = (page.url ? hostOf(page.url) : page.host)?.toLowerCase() || item.paper.host
        const back = (before: Offline | undefined): Offline => {
          const times = (before?.times ?? 0) + 1
          return { times, until: now + OFFLINE_BACKOFF_MS[Math.min(times, OFFLINE_BACKOFF_MS.length) - 1], at: host.replace(/^www\./, "") }
        }
        if (atProxy(lane, item, host)) lane.offline = back(lane.offline)
        else lane.gatesOffline.set(item.gate, back(lane.gatesOffline.get(item.gate)))
      }
      lane.queue.unshift(item)
      sortQueue(lane)
      this.host.papers(this.library, [item.paper.paperId])
    } else if (pause) {
      lane.offline = undefined
      lane.gatesOffline.delete(item.gate)
      item.gate = answerGate(item, page)
      this.notes.ended(item.gate, ended as WorkEnding)
      lane.queue.unshift(item)
      sortQueue(lane)
      const pageHost = page.url ? hostOf(page.url) : page.host
      const at = atOf(item.gate, pause, pageHost)
      // The library's sign-in page for the proxy's own sign-in; the publisher's page for one met there
      const url = (pause === "sign-in" && item.gate.startsWith("proxy:") && item.paper.signIn) || page.url || item.paper.url
      const before = this.waitsAt.get(item.gate)
      const proxy = item.paper.proxied ? item.paper.proxy : undefined
      // A paper that went on when the user got through met the same gate again: that wait is back
      const back = before ? undefined : this.notes.goingWith(item.gate, item.paper.paperId)
      const since = before?.since ?? back?.since ?? page.triedAt ?? now
      // Met again (by its one try on owlit's own, or another paper of it): no more tries until the user
      // acts. A wait it was under elsewhere had its try too.
      const wait: Wait = { gate: item.gate, since, kind: pause, at, url, watch: watchOf(item.gate, lane.key, proxy), by, known: before?.known ?? new Map(), ...(before ? {} : { tryAt: now + PAUSED_RETRY_MS }) }
      this.waitsAt.set(item.gate, wait)
      const follow = this.notes.of(wait)
      if (back?.retried) follow.retried = { ...back.retried, again: true }
      // The page the user had opened was for what it waited for before
      if (before && before.kind !== pause) follow.opened = undefined
      this.notes.changed()
      if (was && was !== before) was.tryAt = undefined
      this.host.papers(this.library, [...new Set([item.paper.paperId, ...this.papersUnder(wait), ...(was ? this.papersUnder(was) : [])])])
      this.host.waits()
    } else {
      lane.offline = undefined
      lane.gatesOffline.delete(item.gate)
      if (ended && ended !== "pdf") this.notes.ended(answerGate(item, page), ended)
      // A try under a wait got through: the user did, somewhere the extension didn't see. One with
      // nothing to fetch any more (the paper went, or has its PDF by another way) says nothing of the
      // wait, which stays for its other papers and goes with the last of them.
      const through = was && (ended !== undefined || !this.count(was)) ? was : undefined
      const freed = through ? this.papersUnder(through) : []
      if (through) this.lift(through)
      if (was) this.host.waits()
      this.leaveIfEmpty(lane)
      this.host.papers(this.library, [...new Set([item.paper.paperId, ...freed])])
    }
    if (ended === "offline") this.notes.ended(item.gate, ended)
    this.warnIfSilent(now)
    this.kick()
  }

  // POST /work/resume: the user got through at this host. Every wait it names (its at, or a host it
  // watches) goes, its papers on at once, the asked for first.
  resume(host: string): boolean {
    return this.goOn([...this.waitsAt.values()].filter((w) => names(w, host)))
  }

  // POST /work/resume { wait }: the extension saw the user get through at this wait
  resumeAt(id: WaitId): boolean {
    const wait = this.waitsAt.get(id)
    return wait ? this.goOn([wait]) : false
  }

  // The user said they got through at this wait (I've signed in, I've verified it): it goes as resume
  // has it, and is followed, so the same wait coming back says it still asks them (retried.again)
  resumeWait(id: WaitId): boolean {
    const wait = this.waitsAt.get(id)
    if (!wait) return false
    const follow = this.notes.of(wait)
    follow.retried = { at: Date.now(), again: false }
    return this.goOn([wait], true)
  }

  // The line of papers that went on after the user got through at this wait, put away
  dismissGoing(id: WaitId): boolean {
    const had = this.notes.dismissGoing(id)
    if (had) this.host.waits()
    return had
  }

  // The waits that went after the user got through, while their papers going on are to be shown: the
  // ids that went on and since when, for the caller to count from the papers
  goneWaits(): FollowUp[] {
    return this.notes.gone().filter((f) => !this.waitsAt.has(f.gate))
  }

  // The follow-ups of a wait that is up
  followUpOf(id: WaitId): FollowUp | undefined {
    const wait = this.waitsAt.get(id)
    return wait && this.notes.get(wait.gate, wait.since)
  }

  // Gates handed papers often lately with no PDF from them and no wait up to say why
  silentZeros(now = Date.now()): GateKey[] {
    return this.notes.quiet(now).filter((gate) => !this.waitsAt.has(gate))
  }

  // How the gates did, as pdf-work.json keeps it
  tallies() {
    return this.notes.tallies()
  }

  // What is still to be written down, now
  flush() {
    return this.notes.flush()
  }

  // byUser: the user said they got through (resumeWait). Otherwise the extension saw a page past the wait
  // load, which may be the user browsing the site for something else: what goes on is theirs only where
  // they had the wait's page opened from owlit, or asked for the paper.
  private goOn(gone: Wait[], byUser = false): boolean {
    if (!gone.length) return false
    const under = gone.map((w) => this.papersUnder(w))
    const freed = under.flat()
    const known = gone.some((w) => w.known.size)
    // Read before the waits go down, which forgets their opened
    const theirs = new Set(gone.flatMap((w, i) => (byUser || this.notes.get(w.gate, w.since)?.opened ? under[i] : [])))
    gone.forEach((w, i) => {
      this.waitsAt.delete(w.gate)
      this.notes.resumed(w.gate)
      this.notes.of(w)
      this.notes.down(w.gate, w.since, under[i])
    })
    for (const lane of this.lanes.values()) {
      if (lane.queue.some((q) => freed.includes(q.paper.paperId))) lane.endedAt = undefined
    }
    // What goes on is what the user started by getting through
    const queued = new Set<string>()
    for (const lane of this.lanes.values())
      for (const q of all(lane))
        if (freed.includes(q.paper.paperId)) {
          q.started ||= theirs.has(q.paper.paperId) || q.askedFor
          queued.add(q.paper.paperId)
        }
    for (const id of freed) if (!queued.has(id) && theirs.has(id)) this.startedIds.add(id)
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
    return this.block([...this.waitsAt.values()].filter((w) => names(w, host)), url)
  }

  // POST /work/blocked { wait, url }: the same for the one wait the extension names
  blockedAt(id: WaitId, url: string): boolean {
    const wait = this.waitsAt.get(id)
    return wait ? this.block([wait], url) : false
  }

  private block(waits: Wait[], url: string): boolean {
    let any = false
    for (const wait of waits) {
      if (wait.kind !== "check" && wait.kind !== "sign-in") continue
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
    for (const wait of [...this.waitsAt.values()]) if (!this.count(wait)) this.lift(wait)
    this.host.waits()
  }

  // The waits, as the window shows them; a paper out for a try still waits there. Without going, which
  // is counted from the papers (followUpOf).
  waits(): ExtensionWait[] {
    return [...this.waitsAt.values()].flatMap((wait) => {
      const papers = this.count(wait)
      if (!papers) return []
      const askedFor = this.itemsUnder(wait).some((q) => q.askedFor)
      const follow = this.notes.get(wait.gate, wait.since)
      return [{ id: wait.gate, kind: wait.kind, at: wait.at, host: wait.at, watch: wait.watch, papers, url: wait.url, askedFor, proxied: wait.gate.startsWith("proxy:"), since: wait.since, ...(follow?.opened ? { opened: follow.opened } : {}), ...(follow?.retried ? { retried: follow.retried } : {}) }]
    })
  }

  // The same for the extension, which watches those sites for the user getting through
  waitsForExtension(): WorkAnswer["waits"] {
    return this.waits().map(({ id, kind, at, host, watch, papers, proxied }) => ({ id, kind, at, host, watch, papers, proxied, allow: allowOf(id, at) }))
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
    this.startedIds.clear()
    const flushed = this.notes.flush().catch((error) => console.error("[core] couldn't keep how getting PDFs went", error))
    this.notes = new PdfWorkNotes(library?.dataDir, { after: flushed })
    this.warned.clear()
    this.host.waits()
  }

  // A wait goes without the user getting through there (a paper of it got through by itself, the user
  // asked for one, none of its papers is left): nothing goes on to follow
  private lift(wait: Wait) {
    this.waitsAt.delete(wait.gate)
    this.notes.down(wait.gate, wait.since)
  }

  // The log says it, once a day per gate, where someone reads it
  private warnIfSilent(now: number) {
    if (!this.options.warnSilentZeros) return
    for (const gate of this.silentZeros(now)) {
      if (now - (this.warned.get(gate) ?? Number.NEGATIVE_INFINITY) < FOLLOW_UP_MS) continue
      this.warned.set(gate, now)
      const t = this.notes.tallies().get(gate)
      console.warn(`[core] ${gate} was handed ${t?.recent.length} papers in a day and gave no PDF, with no wait for the user to say why: its pages may be misread. Endings so far: ${JSON.stringify(t?.endings ?? {})}`)
    }
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

  // The lane's next paper, and when it may go: the first under no wait whose gate isn't backing off
  // (offline), at once; else the one that may go soonest: under no wait once its gate's back-off ends, or
  // under a wait whose one try is due (and no paper of that wait is out already)
  private next(lane: Lane, now = Date.now()): { item: Queued; at: number; wait?: Wait } | undefined {
    let best: { item: Queued; at: number; wait?: Wait } | undefined
    const trying = new Set([...this.lanes.values()].flatMap((l) => (l.inFlight ? [this.waitOver(l, l.inFlight.item)] : [])))
    for (const item of lane.queue) {
      const wait = this.waitOver(lane, item)
      const free = lane.gatesOffline.get(item.gate)?.until ?? 0
      if (!wait && free <= now) return { item, at: 0 }
      if (wait && (wait.tryAt === undefined || trying.has(wait))) continue
      const at = Math.max(wait?.tryAt ?? 0, free)
      if (!best || at < best.at) best = { item, at, ...(wait ? { wait } : {}) }
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
      this.notes.handed(next.item.gate, now)
      const { paperId, url, pdfUrl, host, proxied } = next.item.paper
      out.push({
        id,
        paperId,
        attempt: next.item.tries + 1,
        url,
        ...(pdfUrl ? { pdfUrl } : {}),
        lane: lane.key,
        gate: next.item.gate,
        host,
        proxied,
        ...(tabOnly(next.item.gate) ? { inTab: true as const } : {}),
        ...(next.item.started ? { userStarted: true as const } : {}),
        sites: allowOf(next.item.gate, atOf(next.item.gate, "check", undefined)),
      })
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
const underWait = (wait: Wait) => ({ wait: wait.gate, kind: wait.kind, at: wait.at })

// What a paper of this gate in this lane is backing off from now, if anything: the proxy, else its gate
function offlineOf(lane: Lane, gate: GateKey, now = Date.now()): Offline | undefined {
  const live = (o: Offline | undefined) => (o && o.until > now ? o : undefined)
  const [proxy, own] = [live(lane.offline), live(lane.gatesOffline.get(gate))]
  return proxy && own ? (proxy.until >= own.until ? proxy : own) : (proxy ?? own)
}

// A host that didn't answer is the library proxy's own when the paper goes through it and the host is
// under the proxy's registrable domain (tlink, the school's sign-in beside it, an EZproxy's rewritten
// publisher hosts); any other is the publisher's, which the proxy sent the browser on to
function atProxy(lane: Lane, item: Queued, host: string): boolean {
  if (!lane.proxied) return false
  const proxyHost = lane.key.startsWith("proxy:") ? lane.key.slice("proxy:".length) : item.paper.host
  return siteOf(host) === siteOf(proxyHost)
}

// The wait is named by this host: shown there, or watching it. Not by registrable domain alone: a proxy
// and the identity provider beside it (tlink and id.tsinghua.edu.cn) share one, and a sign-in page
// loading there is not the user through at the proxy.
const names = (wait: Wait, host: string) => wait.at === host || wait.watch.some((h) => host === h || host.endsWith(`.${h}`))

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
