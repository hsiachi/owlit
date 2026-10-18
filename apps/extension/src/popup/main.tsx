import { I18nProvider } from "@lingui/react"
import { i18n } from "@owlit/i18n"
import { intlLocale } from "@owlit/i18n"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { followColorScheme } from "../lib/color-scheme.ts"
import { startI18n } from "../lib/i18n.ts"
import { Popup } from "./Popup.tsx"
import "./popup.css"

document.documentElement.lang = intlLocale(startI18n())
followColorScheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <Popup />
    </I18nProvider>
  </StrictMode>,
)
