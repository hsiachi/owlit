const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const sameYear = (t: number) => new Date(t).getFullYear() === new Date().getFullYear()

// "Oct 15", or "Oct 15, 2025" in another year
export function shortDate(t: number) {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear(t) ? {} : { year: "numeric" }) })
}

// A file date ("2026-10-03") the way the page shows dates
export function dayLabel(iso: string) {
  const t = Date.parse(`${iso}T12:00:00`)
  return Number.isNaN(t) ? iso : shortDate(t)
}

// "just now", "3 min ago", "2 hours ago", "yesterday", then the date
export function ago(t: number) {
  const d = Date.now() - t
  if (d < MIN) return "just now"
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`
  if (d < DAY) {
    const h = Math.floor(d / HOUR)
    return `${h} hour${h === 1 ? "" : "s"} ago`
  }
  if (d < 2 * DAY) return "yesterday"
  return shortDate(t)
}

// This week means the last seven days, as the list groups topics
export const thisWeek = (t: number) => Date.now() - t < 7 * DAY
