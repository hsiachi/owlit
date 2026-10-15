import { execFile } from "node:child_process"

// The system proxy as the variables command-line programs read, for the processes owlit starts (agents
// and their tools, npm). owlit's own requests go through the host's network stack, which follows the
// system's settings (PAC included); a process knows only what its environment says, and an app opened
// from Finder has nothing there. Without it Claude Code went direct and, where its service needs the
// proxy, got "403 Request not allowed" while signed in.

const NAMES = ["http_proxy", "https_proxy", "all_proxy"]

// Proxy variables already in owlit's own environment (started from a shell that sets them) win, as they
// do for every other program started from that shell
export function hasProxyEnv(env: NodeJS.ProcessEnv) {
  return NAMES.some((name) => env[name] || env[name.toUpperCase()])
}

// Asked afresh for each process, so a proxy turned on or off applies to the next one that starts.
// `resolve` answers as a PAC script does ("PROXY host:port; DIRECT"). Each variable is set in both cases:
// curl reads only http_proxy, other programs only HTTP_PROXY.
export async function systemProxyEnv(resolve: (url: string) => Promise<string>, bypass: () => Promise<string[]> = macBypass): Promise<Record<string, string>> {
  // The URL only matters to a PAC script that picks by host; agents mostly talk to their model's service
  const ask = (url: string) => resolve(url).then(proxyUrl, () => null)
  const [https, http] = await Promise.all([ask("https://api.anthropic.com"), ask("http://api.anthropic.com")])
  const env: Record<string, string> = {}
  // Node's fetch and Claude Code take no SOCKS proxy in HTTPS_PROXY; ALL_PROXY is where curl and git look
  for (const [name, url] of [["https_proxy", https], ["http_proxy", http]] as const) {
    if (!url) continue
    if (url.startsWith("socks")) env.all_proxy ??= url
    else env[name] = url
  }
  if (!Object.keys(env).length) return {}
  env.no_proxy = [...new Set(["localhost", "127.0.0.1", "::1", ...(await bypass().catch(() => []))])].join(",")
  return Object.fromEntries(Object.entries(env).flatMap(([name, value]) => [[name, value], [name.toUpperCase(), value]]))
}

// The first way the system would go, as a proxy URL; null when it goes direct
export function proxyUrl(rules: string): string | null {
  const [, kind, address] = /^(\w+) (\S+)$/.exec(rules.split(";")[0].trim()) ?? []
  // socks5h and socks4a: the proxy looks the name up, as it does for Chromium (and must, behind a fake-ip DNS)
  const scheme = ({ PROXY: "http", HTTPS: "https", SOCKS: "socks4a", SOCKS4: "socks4a", SOCKS5: "socks5h" } as Record<string, string>)[kind ?? ""]
  return scheme ? `${scheme}://${address}` : null
}

// macOS's "Bypass proxy settings for these hosts" in NO_PROXY's form: "*.local" becomes ".local", and
// "<local>" (names without a dot) is left out, having no form there. Other systems: none beyond localhost.
async function macBypass(): Promise<string[]> {
  if (process.platform !== "darwin") return []
  const out = await new Promise<string>((resolve) => execFile("scutil", ["--proxy"], { timeout: 2000 }, (error, stdout) => resolve(error ? "" : stdout)))
  return bypassHosts(out)
}

export function bypassHosts(scutil: string): string[] {
  const list = /ExceptionsList : <array> \{([^}]*)\}/.exec(scutil)?.[1] ?? ""
  return [...list.matchAll(/^\s*\d+ : (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((host) => host && host !== "<local>")
    .map((host) => host.replace(/^\*\./, "."))
}
