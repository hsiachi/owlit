// oxlint-disable-next-line typescript/triple-slash-reference -- the .po declaration has to reach every package that imports this file
/// <reference path="./po.d.ts" />
// Every locale's compiled catalog, for a process that may switch to any of them. Kept out of index.ts:
// importing a .po needs the bundler's Lingui plugin (Vite's, or main's esbuild one), which a plain test
// of core's code doesn't have.

import type { Messages } from "@lingui/core"
import type { Locale } from "@owlit/protocol"
import { messages as en } from "../locales/en.po"
import { messages as pseudo } from "../locales/pseudo.po"
import { messages as zhHans } from "../locales/zh-Hans.po"

export const CATALOGS: Record<Locale, Messages> = { en, "zh-Hans": zhHans, pseudo }
