import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isInteractive, isThrough, refusesPdf, verdict, type Page } from "./verdict.ts"

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

// The checks a tab can't pass by waiting, which the fetch ladder leaves to the user at once
describe("recorded checks only a person passes", () => {
  const checks = recorded.filter((page) => page.verdict === "check")
  it.each(checks.map((page) => [page.name, page] as const))("%s", (_, page) => {
    const html = readFileSync(path.join(folder, `${page.name}.html`), "utf8")
    const seen = page.from === "worker" ? { url: page.url, status: page.status, html, headers: new Headers(page.headers) } : { url: page.url, status: 0, html }
    expect(isInteractive(seen), page.really).toBe(/sciencedirect|interactive/i.test(page.name + page.really))
  })
})

// What a PDF's address answers a reader without the paper: never a check, and the paper's own page
describe("recorded PDF addresses keeping the PDF from a reader", () => {
  const refusals = recorded.filter((page) => page.name.endsWith("-closed-pdf.worker"))
  it.each(refusals.map((page) => [page.name, page] as const))("%s", (_, page) => {
    const html = readFileSync(path.join(folder, `${page.name}.html`), "utf8")
    // A 200 counts only when the PDF's address sent the reader away: these are at the paper's page
    const asked = page.status === 200 ? `${page.url}/pdf` : page.url
    expect(refusesPdf({ url: page.url, status: page.status, html }, asked), page.really).toBe(true)
  })
})

// A campus reader's paper page, answered at the address asked: headers and footers offer access to
// readers who have the paper, so nothing here keeps the PDF from them
describe("recorded pages of readers with the paper, at the address asked", () => {
  const campus = recorded.filter((page) => ["sage-article.tab", "oup-article.tab", "science-article.tab"].includes(page.name))
  it("are three", () => expect(campus).toHaveLength(3))
  it.each(campus.map((page) => [page.name, page] as const))("%s", (_, page) => {
    const html = readFileSync(path.join(folder, `${page.name}.html`), "utf8")
    expect(refusesPdf({ url: page.url, status: 200, html }, page.url), page.really).toBe(false)
  })
})

// What scripts/trim-pages.mjs scrubs (scrub) stays out of every page committed: the recorder's address
// and the account, user and session ids a publisher's page data carries
describe("recorded pages say nothing of who recorded them", () => {
  const IPV4 = /(?<![\w/.-])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.-])/g
  const PERSONAL = /"(?:ip|ipAddress|userId|user_id|accountId|account_id|accountName|departmentId|institutionName|institution|institutionID|eventGroupKey)"\s*:\s*(?:"[^"]+"|[1-9]\d*)/g
  const SESSION = /[?&](?:amp;)?(?:sid|sessionid|jsessionid|token|key)=[A-Za-z0-9%_.-]{12,}/gi
  it.each(recorded.map((page) => [page.name] as const))("%s", (name) => {
    const html = readFileSync(path.join(folder, `${name}.html`), "utf8")
    expect((html.match(IPV4) ?? []).filter((ip) => !ip.startsWith("192.0.2."))).toEqual([])
    expect(html.match(PERSONAL) ?? []).toEqual([])
    expect(html.match(SESSION) ?? []).toEqual([])
  })
})
