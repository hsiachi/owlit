import { t } from "@lingui/core/macro"
import { RpcErrorCode, type AvailableRelease, type BuildInfo, type UpdateCheck, type UpdateStatus, type UpdatesView } from "@owlit/protocol"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import type { UpdaterHost } from "../host.ts"
import { RpcFailure } from "../rpc/index.ts"
import { newerVersion } from "./version.ts"

// The first check waits a little after the start, so it never slows the window down; then one a day.
// A check that didn't work is tried again sooner. The clock ticks hourly, and a tick after the Mac slept
// is when a day that passed meanwhile is noticed.
export const FIRST_CHECK_MS = 30_000
export const CHECK_EVERY_MS = 24 * 3_600_000
export const RETRY_MS = 4 * 3_600_000
const TICK_MS = 3_600_000

// <userData>/updates.json: this machine's switch and what it last saw. Kept apart from settings.json,
// which every window reads and writes whole.
interface UpdatesState {
  auto?: boolean
  checkedAt?: number
  failedAt?: number
  // The last release version that started here: a higher one starting is an update
  ranVersion?: string
  // A version whose "Updated to" the window hasn't shown yet
  updated?: string
  // The newer release the last look at GitHub found, for a build that can't install it
  available?: AvailableRelease
}

export interface UpdatesOptions {
  build: BuildInfo
  userDataDir: string
  updater?: UpdaterHost
  // The CHANGELOG.md the app ships, for what's new after an update
  changelog?: string
  // A workspace opened here before: a release starting with no record of the last one is then an
  // update from a version that kept none (0.2.0), not a first install
  onboarded(): Promise<boolean>
  // Chats answering right now: Restart asks first while any is
  answering(): number
  // The latest release (updates/github.ts): an unsigned release, which can't install one, still looks
  // once a day so the person hears a newer Owlit exists
  latest?: () => Promise<AvailableRelease | null>
  notify(view: UpdatesView): void
  now?: () => number
}

// Owlit updating itself. Policy only: when to check, what the window is told, the "Updated to" record.
// The host does the fetching, downloading and installing (the desktop app: electron-updater), and only a
// release build signed with the Developer ID and run from where it can replace itself is given one that
// works; everything else says why it doesn't update itself.
export class Updates {
  private readonly options: UpdatesOptions
  private readonly file: string
  private state: UpdatesState = {}
  private status: UpdateStatus = { kind: "off", reason: "build" }
  private checking: Promise<UpdateCheck> | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private started: Promise<void> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(options: UpdatesOptions) {
    this.options = options
    this.file = path.join(options.userDataDir, "updates.json")
  }

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  start() {
    this.started ??= this.begin()
    return this.started
  }

  private async begin() {
    this.state = (await readJson<UpdatesState>(this.file).catch(() => undefined)) ?? {}
    const { build, updater } = this.options
    // Only a release keeps the record, so a local or dev build sharing its data never fakes an update
    if (build.channel === "release" && this.state.ranVersion !== build.version) {
      const from = this.state.ranVersion
      const updated = from ? newerVersion(build.version, from) : await this.options.onboarded()
      this.state = { ...this.state, ranVersion: build.version, updated: updated ? build.version : this.state.updated }
      this.save()
    }
    const blocked = build.channel !== "release" || !updater ? "build" : await updater.blocked?.()
    if (blocked) {
      this.status = { kind: "off", reason: blocked }
      if (this.looksForReleases()) {
        this.status = this.unsignedStatus()
        this.startClock()
      }
    } else if (updater) {
      this.status = { kind: "idle" }
      this.listen(updater)
      this.startClock()
    }
    await this.changed()
  }

  private listen(updater: UpdaterHost) {
    updater.onProgress((percent) => {
      if (this.status.kind !== "downloading") return
      const rounded = Math.floor(percent)
      if (rounded === this.status.percent) return
      this.status = { ...this.status, percent: rounded }
      void this.changed()
    })
    updater.onDownloaded((version) => {
      this.status = { kind: "ready", version }
      void this.changed()
    })
    // A check's own failure comes back from check(); this is the download's
    updater.onError((error) => {
      if (this.status.kind !== "downloading") return
      console.error("[updates] the download failed:", error)
      this.state = { ...this.state, failedAt: this.now() }
      this.status = { kind: "failed", message: failure(error) }
      this.save()
      void this.changed()
    })
  }

  private startClock() {
    this.timers.push(setTimeout(() => this.tick(), FIRST_CHECK_MS), setInterval(() => this.tick(), TICK_MS))
    for (const timer of this.timers) timer.unref?.()
  }

  // An unsigned release: it can't install an update, but can look for one
  private looksForReleases() {
    return this.status.kind === "off" && this.status.reason === "unsigned" && !!this.options.latest
  }

  // The unsigned state, with the newer release last seen while it is still newer than this build
  private unsignedStatus(): UpdateStatus {
    const available = this.state.available
    return { kind: "off", reason: "unsigned", ...(available && newerVersion(available.version, this.options.build.version) ? { available } : {}) }
  }

  private tick() {
    if (!this.auto || this.status.kind === "ready" || this.status.kind === "downloading") return
    if (this.status.kind === "off" && !this.looksForReleases()) return
    const now = this.now()
    if (now - (this.state.checkedAt ?? 0) < CHECK_EVERY_MS || now - (this.state.failedAt ?? 0) < RETRY_MS) return
    void this.check(false)
  }

  private get auto() {
    return this.state.auto ?? true
  }

  // A check by hand shows what it found, failures too; one by itself fails quietly and tries again later.
  // Two at once share the one request.
  check(byHand = true): Promise<UpdateCheck> {
    this.checking ??= this.runCheck(byHand).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(byHand: boolean): Promise<UpdateCheck> {
    await this.start()
    const { updater, build } = this.options
    const status = this.status
    if (this.looksForReleases()) return this.checkReleases()
    if (status.kind === "off" || !updater) return { kind: "off", reason: status.kind === "off" ? status.reason : "build" }
    // Already on its way: nothing newer to ask for
    if (status.kind === "ready" || status.kind === "downloading") return { kind: "found", version: status.version }
    this.status = { kind: "checking" }
    await this.changed()
    try {
      const version = await updater.check()
      this.state = { ...this.state, checkedAt: this.now(), failedAt: undefined }
      this.status = version ? { kind: "downloading", version } : { kind: "idle" }
      this.save()
      await this.changed()
      return version ? { kind: "found", version } : { kind: "current", version: build.version }
    } catch (error) {
      console.error("[updates] the check failed:", error)
      const message = failure(error)
      this.state = { ...this.state, failedAt: this.now() }
      this.status = byHand ? { kind: "failed", message } : status
      this.save()
      await this.changed()
      return { kind: "failed", message }
    }
  }

  // For an unsigned release: whether GitHub has a newer one. Its failures, by hand or not, leave the
  // state as it was; one by hand is said.
  private async checkReleases(): Promise<UpdateCheck> {
    const { build } = this.options
    try {
      const latest = await this.options.latest!()
      const available = latest && newerVersion(latest.version, build.version) ? latest : undefined
      this.state = { ...this.state, checkedAt: this.now(), failedAt: undefined, available }
      this.status = this.unsignedStatus()
      this.save()
      await this.changed()
      return available ? { kind: "available", release: available } : { kind: "current", version: build.version }
    } catch (error) {
      console.error("[updates] looking for a release failed:", error)
      this.state = { ...this.state, failedAt: this.now() }
      this.save()
      return { kind: "failed", message: failure(error) }
    }
  }

  async setAuto(auto: boolean) {
    await this.start()
    this.state = { ...this.state, auto }
    this.save()
    return this.changed()
  }

  async seen() {
    await this.start()
    if (!this.state.updated) return
    this.state = { ...this.state, updated: undefined }
    this.save()
    await this.changed()
  }

  async restart(force: boolean) {
    await this.start()
    if (this.status.kind !== "ready") throw new RpcFailure(RpcErrorCode.InvalidParams, t`There's no update ready to install.`)
    const answering = this.options.answering()
    if (answering && !force) return { answering }
    this.options.updater?.install()
    return { answering }
  }

  async view(): Promise<UpdatesView> {
    await this.start()
    return this.snapshot()
  }

  private async snapshot(): Promise<UpdatesView> {
    const { build } = this.options
    const updated = this.state.updated
    return {
      build,
      auto: this.auto,
      status: this.status,
      checkedAt: this.state.checkedAt,
      updated: updated ? { version: updated, notes: await this.notes(updated) } : undefined,
    }
  }

  // For Copy Diagnostics: one line
  describe() {
    const { build } = this.options
    const s = this.status
    const where = s.kind === "off" ? `off (${s.reason})${s.available ? `, ${s.available.version} out` : ""}` : s.kind === "downloading" || s.kind === "ready" ? `${s.kind} ${s.version}` : s.kind === "failed" ? `failed: ${s.message}` : s.kind
    const checked = this.state.checkedAt ? `, checked ${new Date(this.state.checkedAt).toISOString()}` : ""
    return `Build: ${build.channel}${build.commit ? ` ${build.commit}` : ""} · Updates: ${where}${this.auto ? "" : ", automatic checks off"}${checked}`
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    return this.saving
  }

  // The version's section of CHANGELOG.md, without its heading
  private async notes(version: string) {
    if (!this.options.changelog) return undefined
    const text = await readFile(this.options.changelog, "utf8").catch(() => "")
    return changelogSection(text, version)
  }

  private async changed() {
    const view = await this.snapshot()
    this.options.notify(view)
    return view
  }

  // Writes queue up, so an older state never lands after a newer one; nothing waits on them
  private save() {
    const state = this.state
    this.saving = this.saving.then(() => writeJsonAtomic(this.file, state)).catch((error) => console.error(`[updates] couldn't write ${this.file}:`, error))
  }
}

export function changelogSection(changelog: string, version: string) {
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start < 0) return undefined
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line))
  const section = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()
  return section || undefined
}

// What went wrong, as the window says it. The network's own codes (Chromium's net::ERR_…, Node's) mean
// GitHub wasn't reached; GitHub turning a check away is mostly its hourly limit for one address.
function failure(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_PROXY|ERR_TIMED_OUT|ERR_NETWORK|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(text)) {
    return t`GitHub couldn't be reached. Check your connection or proxy, then try again.`
  }
  if (/\b(403|429)\b/.test(text)) return t`GitHub turned the check away for now. Try again in an hour.`
  return t`The update didn't come through: ${text.split("\n")[0]}`
}
