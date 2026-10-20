import { I18nProvider } from "@lingui/react"
import { i18n, intlLocale } from "@owlit/i18n"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { startI18n } from "../lib/i18n.ts"
import { followColorScheme } from "../lib/color-scheme.ts"
import { Allow } from "./Allow.tsx"
import "../popup/popup.css"

document.documentElement.lang = intlLocale(startI18n())
followColorScheme()

const query = new URLSearchParams(location.search)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <Allow host={query.get("host") ?? ""} papers={Number(query.get("papers")) || 0} tabId={query.has("tab") ? Number(query.get("tab")) : undefined} />
    </I18nProvider>
  </StrictMode>,
)
