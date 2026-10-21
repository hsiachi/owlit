import { plural, t } from "@lingui/core/macro"
import type { ReadFrom } from "@owlit/protocol"

// How far Owlit read a paper, in the same words wherever the app says it (protocol ReadDepth): the card
// under a chat's answer, a thread's rows and the line over them, a citation's card. A digest is Owlit's
// own text, read instead of the paper's: said apart from the scale.
export type SaidDepth = ReadFrom["depth"]

// The label beside one paper: "Full text", "Part of the text", …
export function readDepthLabel(depth: SaidDepth): string {
  switch (depth) {
    case "full":
      return t({ message: "Full text", context: "read depth", comment: "how far Owlit read a paper: its whole text" })
    case "part":
      return t({ message: "Part of the text", context: "read depth", comment: "how far Owlit read a paper: some of its pages or a section" })
    case "digest":
      return t({ message: "From the digest", context: "read depth", comment: "how Owlit read a paper: only its own digest of it" })
    case "abstract":
      return t({ message: "Abstract only", context: "read depth", comment: "how far Owlit read a paper: its abstract, none of the text" })
    case "title":
      return t({ message: "Title only", context: "read depth", comment: "how far Owlit read a paper: its title, it has no abstract" })
  }
}

// "Owlit, from the full text": where a claim came from, on a citation's card
export function readDepthSource(depth: SaidDepth): string {
  switch (depth) {
    case "full":
      return t`Owlit, from the full text`
    case "part":
      return t`Owlit, from part of the text`
    case "digest":
      return t`Owlit, from its digest`
    case "abstract":
      return t`Owlit, from the abstract`
    case "title":
      return t`Owlit, from the title only`
  }
}

const ORDER: SaidDepth[] = ["full", "part", "digest", "abstract", "title"]

// Several papers in one line, deepest first: "2 full text, 4 abstract only"; when all were read the same
// way, "all full text". Each count is a group, for a caller that marks what a group stands for.
export function readDepthCounts(depths: SaidDepth[]): { depth: SaidDepth; text: string }[] {
  const by = new Map<SaidDepth, number>()
  for (const d of depths) by.set(d, (by.get(d) ?? 0) + 1)
  const groups = ORDER.filter((d) => by.has(d))
  if (groups.length === 1 && depths.length > 1) return [{ depth: groups[0]!, text: allOf(groups[0]!) }]
  return groups.map((depth) => ({ depth, text: countOf(depth, by.get(depth)!) }))
}

export const readDepthSummary = (depths: SaidDepth[]) =>
  readDepthCounts(depths)
    .map((g) => g.text)
    .join(", ")

function countOf(depth: SaidDepth, n: number): string {
  switch (depth) {
    case "full":
      return plural(n, { one: "# full text", other: "# full text" })
    case "part":
      return plural(n, { one: "# part of the text", other: "# part of the text" })
    case "digest":
      return plural(n, { one: "# from the digest", other: "# from the digest" })
    case "abstract":
      return plural(n, { one: "# abstract only", other: "# abstract only" })
    case "title":
      return plural(n, { one: "# title only", other: "# title only" })
  }
}

function allOf(depth: SaidDepth): string {
  switch (depth) {
    case "full":
      return t({ message: "all full text", comment: "every paper an answer rests on was read whole" })
    case "part":
      return t({ message: "all part of the text", comment: "every paper an answer rests on was read in part" })
    case "digest":
      return t({ message: "all from the digest", comment: "every paper an answer rests on was read through Owlit's digest" })
    case "abstract":
      return t({ message: "all abstract only", comment: "every paper an answer rests on was known from its abstract" })
    case "title":
      return t({ message: "all title only", comment: "every paper an answer rests on was known from its title" })
  }
}
