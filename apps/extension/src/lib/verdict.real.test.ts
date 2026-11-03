import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isThrough, verdict, type Page } from "./verdict.ts"

// Real publishers' pages as the extension met them, trimmed by scripts/trim-pages.mjs: from a worker
// fetch (its status and headers) or a tab's document (neither). verdict is the ending a try reports,
// isThrough whether a tab there counts as past the site's check or sign-in.
interface Recorded {
  name: string
  from: "worker" | "tab"
  url: string
  status: number
  headers: Record<string, string>
  proxy?: Page["proxy"]
  really: string
  verdict: string
  isThrough: boolean
}

const folder = path.join(import.meta.dirname, "fixtures/real")
const recorded: Recorded[] = JSON.parse(readFileSync(path.join(folder, "index.json"), "utf8"))

describe("recorded publishers' pages", () => {
  it.each(recorded.map((page) => [page.name, page] as const))("%s", (_, page) => {
    const html = readFileSync(path.join(folder, `${page.name}.html`), "utf8")
    const seen: Page =
      page.from === "worker"
        ? { url: page.url, status: page.status, html, headers: new Headers(page.headers), proxy: page.proxy }
        : { url: page.url, status: 0, html, proxy: page.proxy }
    expect({ verdict: verdict(seen), isThrough: isThrough(seen) }, page.really).toEqual({ verdict: page.verdict, isThrough: page.isThrough })
  })
})
