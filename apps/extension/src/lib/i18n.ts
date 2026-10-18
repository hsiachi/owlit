import { activateLocale } from "@owlit/i18n"
import { CATALOGS } from "@owlit/i18n/catalogs"
import { interfaceLocale } from "@owlit/protocol"

// The extension speaks the browser's language, in owlit's catalogs (English or Chinese)
export function startI18n() {
  const locale = interfaceLocale("system", navigator.languages)
  activateLocale(locale, CATALOGS[locale])
  return locale
}
