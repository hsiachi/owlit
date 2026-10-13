import { t } from "@lingui/core/macro"
import { intlLocale } from "@owlit/i18n"

// Times the way owlit says them (app/src/lib/time.ts): relative while recent, then a short date

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const shortDate = (time: number) =>
  new Date(time).toLocaleDateString(intlLocale(), { month: "short", day: "numeric", ...(new Date(time).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })

export function ago(time: number, now = Date.now()) {
  const d = now - time
  if (d < MINUTE) return t`Just now`
  if (d < HOUR) {
    const minutes = Math.floor(d / MINUTE)
    return t`${minutes} min ago`
  }
  if (d < 12 * HOUR) {
    const hours = Math.floor(d / HOUR)
    return t`${hours} h ago`
  }
  return shortDate(time)
}
