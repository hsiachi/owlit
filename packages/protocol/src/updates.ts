// Owlit updating itself: where this build came from, and where an update stands. Only a release build
// signed with the Developer ID updates itself; the others say why they don't.

// release: built by pnpm release and sent to people. local: built from a checkout (pnpm build, pnpm
// app:install). dev: pnpm dev and pnpm try.
export type BuildChannel = "release" | "local" | "dev"

export interface BuildInfo {
  version: string
  channel: BuildChannel
  // The commit it was built at, short; "+" at the end when the checkout had changes
  commit?: string
}

// Where owlit's releases are published, until it has a site of its own: the latest one's page, and the
// API that names it
export const RELEASES_URL = "https://github.com/hsiachi/owlit/releases/latest"
export const LATEST_RELEASE_API = "https://api.github.com/repos/hsiachi/owlit/releases/latest"

// A release newer than this build, for a build that can't install it itself
export interface AvailableRelease {
  version: string
  // Its page, where it is downloaded
  url: string
  // Its notes, Markdown; absent when it has none
  notes?: string
}

export type UpdateStatus =
  // This build doesn't update itself; why, as one of the reasons below. An unsigned release still looks
  // for a newer one, and names it here when there is one.
  | { kind: "off"; reason: "build" | "unsigned" | "location"; available?: AvailableRelease }
  // No check has run yet, or the last one found nothing newer
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; version: string; percent?: number }
  // Downloaded: installs when Owlit quits, or now on Restart
  | { kind: "ready"; version: string }
  // The last check or download didn't work: one sentence
  | { kind: "failed"; message: string }

export interface UpdatesView {
  build: BuildInfo
  // Check by itself (about a minute after starting, then once a day); off leaves Check for Updates…
  auto: boolean
  status: UpdateStatus
  // When a check last reached the feed, whatever it found
  checkedAt?: number
  // Set on the first start of a newer version, until the window has said so (updates.seen)
  updated?: UpdatedNote
}

export interface UpdatedNote {
  version: string
  // That version's CHANGELOG section, Markdown; absent when it has none
  notes?: string
}

// What a check started by hand found
export type UpdateCheck =
  | { kind: "off"; reason: "build" | "unsigned" | "location" }
  // A newer release exists that this build can't install itself
  | { kind: "available"; release: AvailableRelease }
  | { kind: "current"; version: string }
  | { kind: "found"; version: string }
  | { kind: "failed"; message: string }
