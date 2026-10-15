import { describe, expect, it } from "vitest"
import { routeSubject } from "./route-subject"

describe("routeSubject", () => {
  it("names the thing an item page shows", () => {
    expect(routeSubject("/library/arxiv-2401.01234")).toEqual({ kind: "paper", id: "arxiv-2401.01234" })
    expect(routeSubject("/docs/d1")).toEqual({ kind: "doc", id: "d1" })
    expect(routeSubject("/chat/c1")).toEqual({ kind: "chat", id: "c1" })
    expect(routeSubject("/collections/c-replay")).toEqual({ kind: "collection", id: "c-replay" })
  })

  it("decodes the id", () => {
    expect(routeSubject("/chat/a%20b")).toEqual({ kind: "chat", id: "a b" })
  })

  it("takes a place's own pages and lists for no subject", () => {
    for (const p of ["/", "/library", "/library/", "/library/up-next", "/docs", "/chat", "/collections", "/knowledge/x", "/library/p1/more"]) expect(routeSubject(p)).toBeNull()
  })
})
