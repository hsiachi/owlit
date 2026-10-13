import { I18nProvider } from "@lingui/react"
import { interfaceLocale } from "@owlit/protocol"
import { activateLocale, i18n, intlLocale } from "@owlit/i18n"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

// The reader's language is their browser's (Chinese or English), and the theme follows their system. Only
// that language's catalog is fetched.
const catalogs = {
  en: () => import("../../../packages/i18n/locales/en.po"),
  "zh-Hans": () => import("../../../packages/i18n/locales/zh-Hans.po"),
  pseudo: () => import("../../../packages/i18n/locales/pseudo.po"),
}
const locale = interfaceLocale("system", navigator.languages)
document.documentElement.lang = intlLocale(locale)

const dark = window.matchMedia("(prefers-color-scheme: dark)")
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches)
applyTheme()
dark.addEventListener("change", applyTheme)

void catalogs[locale]().then(({ messages }) => {
  activateLocale(locale, messages)
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <App />
      </I18nProvider>
    </StrictMode>,
  )
})
