import { t } from "@lingui/core/macro"
import { intlLocale } from "@owlit/i18n"

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const sameYear = (t: number) => new Date(t).getFullYear() === new Date().getFullYear()

// Dates and times are written the interface language's way (Intl): "Oct 15" or "10月15日"

// "Oct 15", or "Oct 15, 2025" in another year
export function shortDate(t: number) {
  return new Date(t).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", ...(sameYear(t) ? {} : { year: "numeric" }) })
}

// "3:40 PM"
export const clock = (t: number) => new Date(t).toLocaleTimeString(intlLocale(), { hour: "numeric", minute: "2-digit" })

// "Oct 15, 3:40 PM"
export function dateTime(t: number) {
  return new Date(t).toLocaleString(intlLocale(), { month: "short", day: "numeric", ...(sameYear(t) ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" })
}

// When a message was sent or answered: "3:40 PM" today, "Oct 15, 3:40 PM" on any other day. A clock time
// alone reads as today, so a days-old chat showing one misleads.
export function timeStamp(t: number, now = Date.now()) {
  return t >= startOfDay(now) ? clock(t) : dateTime(t)
}

// "Just now", "12 min ago", "3 h ago", "Yesterday", then the date. Inside a sentence ("read yesterday",
// "Owlit last read your workspace just now") the two words lower their capital, as their own messages so
// a language without capitals, or with other rules for them, writes each form its own way.
export function ago(time: number, { inSentence = false, now = Date.now() } = {}) {
  const d = now - time
  if (d < MINUTE) return inSentence ? t`just now` : t`Just now`
  if (d < HOUR) {
    const minutes = Math.floor(d / MINUTE)
    return t`${minutes} min ago`
  }
  const today = startOfDay(now)
  if (time >= today || d < 12 * HOUR) {
    const hours = Math.floor(d / HOUR)
    return t`${hours} h ago`
  }
  if (time >= today - DAY) return inSentence ? t`yesterday` : t`Yesterday`
  return shortDate(time)
}
