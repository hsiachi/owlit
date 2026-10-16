import type { PaperRecord } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { hostOf } from "../net/http.ts"
import { extensionRoute, PUBLISHER_HOSTS, siteOf, yourBrowser } from "./browser-routes.ts"
import { routesFor, type Route } from "./pdf.ts"
import { publisherOf, PUBLISHERS, type PublisherKeys } from "./publisher-table.ts"

const record = (doi: string): PaperRecord => ({ version: 1, id: "x", ids: { doi }, title: "T", authors: [], fields: {}, pdfUrls: [] })

const collect = async (routes: AsyncIterable<Route>) => {
  const all: Route[] = []
  for await (const route of routes) all.push(route)
  return all
}

// A DOI under each of a publisher's prefixes
const doisOf = (prefixes: string[]) => prefixes.map((prefix) => `${prefix}0123456`)

// A DOI no publisher's prefix names, as one moved to another publisher's site has
const MOVED = "10.9999/moved.1"

describe("the publisher table", () => {
  it("gives each prefix to one publisher, and each site to one browser row", () => {
    const prefixes = PUBLISHERS.flatMap((p) => p.prefixes)
    expect(new Set(prefixes).size).toBe(prefixes.length)
    const sites = PUBLISHERS.filter((p) => p.browser).flatMap((p) => [...new Set((p.hosts ?? []).map(siteOf))])
    expect(new Set(sites).size).toBe(sites.length)
  })

  it("sends every publisher's DOIs to its own routes, by prefix and by host", async () => {
    const keys: PublisherKeys = { elsevierApiKey: "els", wileyTdmToken: "wiley" }
    const lookups = { landing: async () => "https://landing.example.org/article/1/", unpaywall: async () => [], keys }
    for (const publisher of PUBLISHERS) {
      const hosts = publisher.hosts ?? []
      for (const host of hosts) expect(PUBLISHER_HOSTS).toContain(host)
      for (const doi of doisOf(publisher.prefixes)) {
        expect(publisherOf(doi)?.name).toBe(publisher.name)
        const routes = await collect(routesFor(record(doi), lookups))
        const expected = [...(publisher.api ? [`api:${publisher.name}`] : []), ...(publisher.pdf ? [`publisher:${publisher.name}`] : [])]
        expect(routes.map((r) => r.name)).toEqual(expected)
        const api = routes.find((r) => r.kind === "api")
        if (publisher.api) expect(api).toMatchObject({ url: publisher.api.url(doi), headers: { [publisher.api.header]: keys[publisher.api.key] } })
        // The plain PDF link is on the publisher's own host, unless it hangs off the landing page
        const plain = routes.find((r) => r.kind === "publisher")
        if (plain && hosts.length && !publisher.pdf?.includes("{landing}")) expect(hosts).toContain(hostOf(plain.url))

        const direct = extensionRoute(doi, undefined)
        const mine = yourBrowser(doi)
        if (!publisher.browser) {
          expect(direct.url).toBe(`https://doi.org/${doi}`)
          expect(mine.address).toBe(`https://doi.org/${doi}`)
          continue
        }
        // Without its own article page, where doi.org sends readers
        expect(publisher.browser.landing ? hosts.map(siteOf) : ["doi.org"]).toContain(direct.host)
        expect([...hosts, "doi.org"]).toContain(hostOf(mine.address))
        expect(mine.opens).toBe(publisher.browser.download ? "pdf" : "page")
        // A DOI found at one of its hosts goes the same way as one of its own
        for (const host of hosts) {
          expect(yourBrowser(MOVED, host).address).toBe(mine.address.replace(doi, MOVED))
          if (publisher.browser.landing) expect(extensionRoute(MOVED, undefined, `https://${host}/doi/${MOVED}`)).toMatchObject({ url: direct.url.replace(doi, MOVED), host: direct.host })
        }
      }
      // A host of a publisher without a browser row says nothing about where to send the user's browser
      if (!publisher.browser) for (const host of hosts) expect(yourBrowser(MOVED, host).address).toBe(`https://doi.org/${MOVED}`)
    }
  })
})
