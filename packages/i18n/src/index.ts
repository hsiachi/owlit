// The one translation instance a process uses. Lingui's macros (t`…`, <Trans>, plural) compile to calls
// on it (lingui.config.ts names this module as their runtime), so the renderer, main and core all
// translate through whichever locale their process has loaded.
//
// Messages are written in English in the code; the catalogs in ../locales hold each language's version,
// pulled out by `pnpm i18n:extract`. It starts in English with no catalog: outside production the macros
// carry the English text themselves, so tests and scripts read plain English without loading anything.

import { setupI18n, type Messages } from "@lingui/core"
import type { Locale } from "@owlit/protocol"

export const i18n = setupI18n({ locale: "en", messages: { en: {} } })

// Switches the process to a locale with its compiled catalog. The page's dates and numbers follow
// i18n.locale too (Intl), so they change with it.
export function activateLocale(locale: Locale, messages: Messages) {
  if (i18n.locale === locale && Object.keys(i18n.messages).length) return
  i18n.loadAndActivate({ locale, messages })
}

// The BCP 47 tag Intl and the page's lang attribute take for a locale; the pseudo locale formats as English
export const intlLocale = (locale: string = i18n.locale) => (locale === "pseudo" ? "en" : locale)
