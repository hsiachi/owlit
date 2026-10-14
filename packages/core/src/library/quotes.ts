// Where a quote sits in a paper's text.md: its 1-based page, or null when the words aren't there. Line
// breaks, hyphenation at a break and spacing don't count.
export function findQuote(textMd: string, quote: string): number | null {
  const squash = (s: string) => s.toLowerCase().replace(/-\s*\n\s*/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const want = squash(quote)
  if (!want) return null
  const pages: { page: number; text: string }[] = []
  let page = 1
  for (const chunk of textMd.split(/(<!-- page \d+ -->)/)) {
    const marker = /^<!-- page (\d+) -->$/.exec(chunk)
    if (marker) page = Number(marker[1])
    else if (squash(chunk)) pages.push({ page, text: squash(chunk) })
  }
  const on = pages.find((p) => p.text.includes(want))
  if (on) return on.page
  // Across a page break: the page it starts on
  return pages.find((p, i) => i + 1 < pages.length && `${p.text} ${pages[i + 1]!.text}`.includes(want))?.page ?? null
}
