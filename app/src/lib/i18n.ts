// The interface's language in the page. Strings are Lingui macros (t`…` for text, <Trans> for text with
// markup inside, plural() for counts); they translate through the one instance in @owlit/i18n. The
// desktop app hands over its locale before the first frame (the preload); Settings changes it after.
//
// A change remounts the routed page (main.tsx keys it by locale) rather than asking every component to
// listen: anything that said a word re-renders in the new language, including words a helper put
// together (dates, counts) and words kept in a memoised component. What the page holds lives in stores,
// which a remount keeps.

import { activateLocale, i18n, intlLocale } from "@owlit/i18n"
import { CATALOGS } from "@owlit/i18n/catalogs"
import type { Locale } from "@owlit/protocol"

export { i18n }

export function applyLocale(locale: Locale) {
  activateLocale(locale, CATALOGS[locale])
  // Which glyphs the system picks for Chinese characters, and how the page hyphenates, follow lang
  document.documentElement.lang = intlLocale(locale)
}
