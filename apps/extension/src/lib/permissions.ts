// Which sites the extension may read, and asking for them. Chrome grants the manifest's publisher sites at
// install; Firefox shows them at install but treats every host permission as optional, and either browser
// lets the user take them back. So the popup checks, and asks for the whole list in one click when any is
// missing; a site owlit's queue needs beyond the list is asked for on its own (originsOf).
//
// permissions.request must run straight from the click: Firefox refuses it once anything was awaited
// before it ("may only be called from a user input handler"), so nothing here awaits before asking.

type Permissions = Pick<typeof chrome.permissions, "contains" | "request">
// The extension's manifest (runtime.getManifest()), or what of it is read here
type Manifest = chrome.runtime.Manifest | { host_permissions?: string[] }

// A site's own addresses and every one under it: what the extension asks the user to let it read for
// owlit's papers there
export const originsOf = (host: string) => [`https://${host}/*`, `https://*.${host}/*`]

// Of the sites owlit's papers wait to be allowed on, the ones still to allow, and the ones the extension
// may read already (allowed since, in Settings or another popup), which owlit only has to be told of. The
// popup never offers to allow a site it has: allowing it again changes nothing.
export async function notYetAllowed<W extends { host: string }>(permissions: Pick<Permissions, "contains">, waits: W[]): Promise<{ needed: W[]; allowed: string[] }> {
  const needed: W[] = []
  const allowed: string[] = []
  for (const wait of waits) {
    if (await permissions.contains({ origins: originsOf(wait.host) }).catch(() => false)) allowed.push(wait.host)
    else needed.push(wait)
  }
  return { needed, allowed }
}

// The publisher sites the manifest lists (its https host permissions; 127.0.0.1 is owlit itself, which
// answers the extension whether or not that one is granted)
export const knownSites = (manifest: Manifest) => ("host_permissions" in manifest ? (manifest.host_permissions ?? []) : []).filter((origin: string) => origin.startsWith("https://"))

export async function hasKnownSites(permissions: Permissions, manifest: Manifest): Promise<boolean> {
  const origins = knownSites(manifest)
  if (!origins.length) return true
  return permissions.contains({ origins }).catch(() => false)
}

// granted: the user allowed them; refused: the user said no; unasked: the browser wouldn't ask (not
// from a click, or an origin it rejects), which the popup says as a sentence rather than an error
export type Asked = "granted" | "refused" | "unasked"

// The request is made synchronously, inside the click's turn: an async function runs up to its first await
async function asking(request: () => Promise<boolean>): Promise<Asked> {
  try {
    return (await request()) ? "granted" : "refused"
  } catch {
    return "unasked"
  }
}

// Every site on the list at once; a site already granted is not asked again by the browser
export const askForKnownSites = (permissions: Permissions, manifest: Manifest) => asking(() => permissions.request({ origins: knownSites(manifest) }))

export const askForOrigins = (permissions: Permissions, origins: string[]) => asking(() => permissions.request({ origins }))
