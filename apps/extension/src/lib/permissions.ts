// Which sites the extension may read, and asking for them. Chrome grants the manifest's publisher sites at
// install; Firefox shows them at install but treats every host permission as optional, and either browser
// lets the user take them back. So the popup checks, and asks for the whole list in one click when any is
// missing; a site owlit's queue needs beyond the list is asked for on its own (originsOf, messages.ts).
//
// permissions.request must run straight from the click: Firefox refuses it once anything was awaited
// before it ("may only be called from a user input handler"), so nothing here awaits before asking.

type Permissions = Pick<typeof chrome.permissions, "contains" | "request">
// The extension's manifest (runtime.getManifest()), or what of it is read here
type Manifest = chrome.runtime.Manifest | { host_permissions?: string[] }

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
