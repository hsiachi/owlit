import { appendFile, rename, stat } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"

// How often owlit visits each publisher's site on its own, so that it reads to the site as one reader
// rather than a script. Sites put a check in front of clients that come in bursts or come back right
// after a no, and the check gets stricter each time (2026-10-13: the daily retry opened ten ACM pages
// in three minutes, each one twice, and from then on ACM's check never passed in owlit's browser).
//
// - Unattended visits to one site are spaced out (VISIT_GAP_MS).
// - A site that asked for a person and didn't let an unattended visit through is held: none of its
//   papers is visited unattended until the hold runs out or the user gets through there (Check now).
// - A site that turns plain downloads away (Cloudflare answering core's fetch with a check) is only
//   reached through the browser for a while.
//
// Kept in <data>/publishers.json, by site (registrable domain: sciencedirect.com, acm.org). What
// happened on each visit goes to <data>/publisher-log.jsonl, to tell whether this works.

export const VISIT_GAP_MS = 90_000
export const HOLD_MS = 24 * 60 * 60 * 1000
const PLAIN_REFUSED_MS = 7 * 24 * 60 * 60 * 1000
const LOG_MAX_BYTES = 2 * 1024 * 1024

export type HoldReason = "challenge" | "refused"

interface SiteRecord {
  // No unattended visit before this
  heldUntil?: number
  heldFor?: HoldReason
  // Plain downloads are turned away until this
  plainRefusedUntil?: number
}

interface PublishersFile {
  version: 1
  sites: Record<string, SiteRecord>
}

export class Publishers {
  private readonly file: string
  private readonly logFile: string
  private sites: Record<string, SiteRecord> | undefined
  // When owlit last opened a page of each site, this run of the app
  private readonly lastVisit = new Map<string, number>()
  private writing: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "publishers.json")
    this.logFile = path.join(dataDir, "publisher-log.jsonl")
  }

  // The hold on a site, while it lasts
  async held(site: string): Promise<{ until: number; reason: HoldReason } | undefined> {
    const record = (await this.load())[site]
    if (!record?.heldUntil || record.heldUntil <= Date.now()) return undefined
    return { until: record.heldUntil, reason: record.heldFor ?? "challenge" }
  }

  // The first of these sites that is held
  async heldAny(sites: string[]) {
    for (const site of sites) {
      const hold = await this.held(site)
      if (hold) return { site, ...hold }
    }
    return undefined
  }

  hold(site: string, reason: HoldReason) {
    return this.change(site, { heldUntil: Date.now() + HOLD_MS, heldFor: reason })
  }

  release(site: string) {
    return this.change(site, { heldUntil: undefined, heldFor: undefined })
  }

  async plainRefused(site: string) {
    const until = (await this.load())[site]?.plainRefusedUntil
    return !!until && until > Date.now()
  }

  refusePlain(site: string) {
    return this.change(site, { plainRefusedUntil: Date.now() + PLAIN_REFUSED_MS })
  }

  // How long an unattended visit to the site should wait for its turn (0: go now). OWLIT_VISIT_GAP_MS
  // (tests) changes the gap.
  waitFor(site: string) {
    const last = this.lastVisit.get(site)
    const gap = Number(process.env.OWLIT_VISIT_GAP_MS ?? VISIT_GAP_MS)
    return last === undefined ? 0 : Math.max(0, last + gap - Date.now())
  }

  visited(site: string) {
    this.lastVisit.set(site, Date.now())
  }

  // One line per event; the file starts over (keeping one old copy) past 2 MB
  log(entry: Record<string, unknown>) {
    this.writing = this.writing
      .then(async () => {
        const size = await stat(this.logFile).then((s) => s.size, () => 0)
        if (size > LOG_MAX_BYTES) await rename(this.logFile, `${this.logFile}.1`)
        await appendFile(this.logFile, `${JSON.stringify({ at: Date.now(), ...entry })}\n`)
      })
      .catch((error) => console.error("[core] couldn't write the publisher log", error))
    return this.writing
  }

  private async load() {
    this.sites ??= (await readJson<PublishersFile>(this.file).catch(() => undefined))?.sites ?? {}
    return this.sites
  }

  private async change(site: string, patch: Partial<SiteRecord>) {
    const sites = await this.load()
    const record = { ...sites[site], ...patch }
    for (const key of Object.keys(record) as (keyof SiteRecord)[]) if (record[key] === undefined) delete record[key]
    if (Object.keys(record).length) sites[site] = record
    else delete sites[site]
    this.writing = this.writing.then(() => writeJsonAtomic(this.file, { version: 1, sites } satisfies PublishersFile)).catch((error) => console.error("[core] couldn't keep publishers.json", error))
    await this.writing
  }
}
