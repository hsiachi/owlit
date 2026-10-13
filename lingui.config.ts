import { defineConfig } from "@lingui/cli"
import { formatter } from "@lingui/format-po"
import { createSwcExtractor } from "@lingui/native-tools"

// One catalog per language for everything that shows words: the renderer, the desktop shell's menus and
// dialogs, and core's messages that reach the screen. Messages are English in the code; `pnpm
// i18n:extract` gathers them into packages/i18n/locales/<locale>.po, where each language is written.
// Text meant for agents (prompts, tool descriptions, the how-to guide) is not a message: it stays English.
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "zh-Hans", "pseudo"],
  pseudoLocale: { locale: "pseudo" },
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/packages/i18n/locales/{locale}",
      include: ["<rootDir>/app/src", "<rootDir>/apps/desktop/src", "<rootDir>/packages/core/src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/node_modules/**"],
    },
  ],
  // Macros translate through the process's one instance (packages/i18n)
  runtimeConfigModule: { i18n: ["@owlit/i18n", "i18n"] },
  extractors: [createSwcExtractor()],
  // Grouped by the file they come from, so a page's words read together; without line numbers or a
  // creation date, so moving code or extracting again doesn't touch the catalogs
  orderBy: "origin",
  format: formatter({ lineNumbers: false, customHeaderAttributes: { "POT-Creation-Date": "" } }),
})
