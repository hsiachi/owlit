// The keys getting PDFs through the browser is arranged by, made only in core
// (packages/core/src/extension/keys.ts) and compared whole everywhere else.

// Who can stop a fetch: a publisher of owlit's table (pub:elsevier), a site it has no row for, by
// registrable domain (site:example.org), or the library proxy's own sign-in (proxy:<its host>)
export type GateKey = `pub:${string}` | `site:${string}` | `proxy:${string}`

// Whose pace a fetch follows: the library proxy, which every paper through it shares, or the paper's
// own gate
export type LaneKey = GateKey

// A wait for the user is one per gate at a time, named by it
export type WaitId = GateKey

// Hosts a publisher's single sign-on passes through on its way to the reader's library or back: Elsevier's,
// OpenAthens' and Atypon's. A page ended at one is a step of that publisher's sign-in, never a gate of its
// own or the proxy's.
export const SSO_HOP_HOSTS = ["auth.elsevier.com", "login.openathens.net", "iam.atypon.com"] as const
