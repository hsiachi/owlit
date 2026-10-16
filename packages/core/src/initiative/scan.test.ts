import type { DocComment } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { foldable, halfDone, halfDoneSince, passageChanged, sectionsOf, WEEK_MS } from "./scan.ts"

const DOC = `---
title: Draft
---
# Draft

Opening words.

## Related work

## Method

TODO: say how the ratings were collected.

### Participants

Twelve people.

## Results

\`\`\`
# not a heading
\`\`\`

## Discussion
`

const now = Date.parse("2026-10-16T09:00:00Z")

describe("Owlit's daily look", () => {
  it("finds sections left half done: empty, or marked to do; a heading with subsections isn't empty", () => {
    const sections = sectionsOf(DOC)
    expect(sections.map((s) => s.title)).toEqual(["Draft", "Related work", "Method", "Participants", "Results", "Discussion"])
    expect(halfDone(sections).map((s) => s.heading)).toEqual(["## Related work", "## Method", "## Discussion"])
  })

  it("remembers when each section was first found half done, and forgets one filled in", () => {
    const first = halfDoneSince(halfDone(sectionsOf(DOC)), undefined, now)
    expect(Object.values(first)).toEqual([now, now, now])
    const filled = DOC.replace("## Related work\n", "## Related work\n\nCiteSee and others.\n")
    const later = halfDoneSince(halfDone(sectionsOf(filled)), first, now + WEEK_MS)
    expect(Object.values(later)).toEqual([now, now])
  })

  const comment = (quote: string, prefix: string, suffix: string, lastAt: number, by: "owlit" | "you" = "owlit"): DocComment => ({
    id: quote,
    quote,
    prefix,
    suffix,
    createdAt: lastAt,
    entries: [{ id: "e", by, text: "Lee 2024 says otherwise.", at: lastAt }],
  })

  it("folds Owlit's comments whose passage changed and that nobody answered in a week", () => {
    const content = "# Story\n\nReplay ratings drift from live ones.\n"
    const changed = comment("Replay ratings track the live ones.", "", "", now - WEEK_MS)
    const kept = comment("Replay ratings", "\n\n", " drift", now - WEEK_MS)
    const recent = comment("gone words", "", "", now - 1000)
    const yours = comment("other gone words", "", "", now - WEEK_MS, "you")
    expect(passageChanged(changed, content)).toBe(true)
    expect(passageChanged(kept, content)).toBe(false)
    expect(foldable([changed, kept, recent, yours, { ...changed, id: "done", resolvedAt: now }], content, now).map((c) => c.id)).toEqual([changed.id])
  })
})
