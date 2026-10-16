// The browser's name as the user knows it, for owlit's question "An extension in Chrome wants to connect"
// and Settings' list. Chromium browsers say who they are in userAgentData's brands, beside "Chromium"
// and a made-up brand; Firefox and Safari only in the user agent.
export function browserName(): string {
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] }; brave?: unknown }
  if (nav.brave) return "Brave"
  const brand = nav.userAgentData?.brands.map((b) => b.brand).find((b) => !/chromium|not.?a.?brand/i.test(b))
  if (brand) return brand.replace(/^(Google|Microsoft)\s+/, "")
  const agent = navigator.userAgent
  if (/Firefox\//.test(agent)) return "Firefox"
  if (/Edg\//.test(agent)) return "Edge"
  if (/Safari\//.test(agent) && !/Chrome\//.test(agent)) return "Safari"
  return "Chromium"
}
