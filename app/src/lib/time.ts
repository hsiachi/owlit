export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const sameYear = (t: number) => new Date(t).getFullYear() === new Date().getFullYear()

// "Oct 15", or "Oct 15, 2025" in another year
export function shortDate(t: number) {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear(t) ? {} : { year: "numeric" }) })
}

// "Oct 15, 3:40 PM"
export function dateTime(t: number) {
  return `${shortDate(t)}, ${new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

// A file date ("2026-10-03") the way the page shows dates
export function dayLabel(iso: string) {
  const t = Date.parse(`${iso}T12:00:00`)
  return Number.isNaN(t) ? iso : shortDate(t)
}

// "Just now", "12 min ago", "3 h ago", "Yesterday", then the date. Inside a sentence ("read yesterday",
// "Owlit last read your workspace just now") the two words lower their capital.
export function ago(t: number, { inSentence = false, now = Date.now() } = {}) {
  const d = now - t
  const word = (w: string) => (inSentence ? w.toLowerCase() : w)
  if (d < MINUTE) return word("Just now")
  if (d < HOUR) return `${Math.floor(d / MINUTE)} min ago`
  const today = startOfDay(now)
  if (t >= today || d < 12 * HOUR) return `${Math.floor(d / HOUR)} h ago`
  if (t >= today - DAY) return word("Yesterday")
  return shortDate(t)
}
