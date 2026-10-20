import { LATEST_RELEASE_API, type AvailableRelease } from "@owlit/protocol"

// The latest release on GitHub, for a build that can't install updates itself but can say one exists.
// Only the release's tag, page and notes are read; nothing is downloaded.
export async function latestRelease(getJson: (url: string) => Promise<unknown>): Promise<AvailableRelease | null> {
  const release = (await getJson(LATEST_RELEASE_API)) as { tag_name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown } | null
  if (!release || typeof release.tag_name !== "string" || typeof release.html_url !== "string" || release.draft || release.prerelease) return null
  const notes = typeof release.body === "string" && release.body.trim() ? release.body.trim() : undefined
  return { version: release.tag_name.replace(/^v/, ""), url: release.html_url, ...(notes && { notes }) }
}
