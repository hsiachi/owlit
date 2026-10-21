import { describe, expect, it } from "vitest"
import { citesOtherIn, passageIn, passageInAbstract, placeOf, sentencesOf } from "./passage.ts"

const TEXT = [
  "<!-- page 1 -->",
  "## 1 Introduction",
  "Agents read papers for people. Reicherts et al. (2021) define proactive help as acting before being asked. We build on that.",
  "<!-- page 2 -->",
  "## 4 Results",
  "Participants finished faster with the agent. Completion rose from 62% to 86%, e.g. in the second task. The effect held for novices.",
  "*Figure 2: completion by task.*",
  "Table 3: Completion by condition.",
  "| condition | done |\n| --- | --- |\n| agent | 86% |",
  "<!-- page 3 -->",
  "Most participants preferred the agent [12]. A few did not.",
  "## References",
  "[11] A. Other. Something else. 2019.",
  "[12] B. Author. Agents that read. CHI 2022.",
].join("\n\n")

describe("sentencesOf", () => {
  it("cuts at a full stop before a capital, not after an abbreviation", () => {
    expect(sentencesOf("Rose to 86%, e.g. in Task two. Then fell. Smith et al. Found more.")).toEqual(["Rose to 86%, e.g. in Task two.", "Then fell.", "Smith et al. Found more."])
    expect(sentencesOf("第一句。第二句。")).toEqual(["第一句。", "第二句。"])
  })
})

describe("passageIn", () => {
  it("gives the page, the heading above and the sentence either side", () => {
    expect(passageIn(TEXT, "completion rose from 62% to 86%, e.g. in the second task")).toEqual({
      page: 2,
      section: "4 Results",
      before: "Participants finished faster with the agent.",
      after: "The effect held for novices.",
    })
  })

  it("stops at a heading and shows a table beside the sentence as [Table n]", () => {
    expect(passageIn(TEXT, "Participants finished faster with the agent.")).toMatchObject({ page: 2 })
    expect(passageIn(TEXT, "Participants finished faster with the agent.")?.before).toBeUndefined()
    expect(passageIn(TEXT, "The effect held for novices.")?.after).toBe("[Table 3]")
  })

  it("finds a sentence across a page break, on the page it starts on", () => {
    const text = "<!-- page 4 -->\n\nThe agent helped the\n\n<!-- page 5 -->\n\nnovices most. Experts less."
    expect(passageIn(text, "The agent helped the novices most.")).toEqual({ page: 4, after: "Experts less." })
  })

  it("cuts long neighbours at a word, with an ellipsis", () => {
    const long = "This sentence before the quote goes on and on about many things that the reader does not need to see in the card at all."
    const p = passageIn(`${long} The quote is here.`, "The quote is here.")
    expect(p?.before?.startsWith("…")).toBe(true)
    expect(p!.before!.length).toBeLessThanOrEqual(96)
  })

  it("is null when the words aren't there", () => {
    expect(passageIn(TEXT, "Nobody preferred the agent.")).toBeNull()
  })
})

describe("passageInAbstract and placeOf", () => {
  const abstract = "We study agents. They help novices most. Experts gain less."

  it("finds a sentence of the abstract with its neighbours", () => {
    expect(passageInAbstract(abstract, "they help novices most")).toEqual({ abstract: true, before: "We study agents.", after: "Experts gain less." })
    expect(passageInAbstract(abstract, "nothing like it")).toBeNull()
  })

  it("puts the abstract first, then the text, then nothing", () => {
    expect(placeOf("They help novices most.", { abstract, text: `${abstract}\n\nThey help novices most.` })).toMatchObject({ abstract: true })
    expect(placeOf("A few did not.", { abstract, text: TEXT })).toMatchObject({ page: 3, section: "4 Results" })
    expect(placeOf("A few did not.", { abstract, text: null })).toBeNull()
    expect(placeOf("Nothing like it.", { abstract, text: TEXT })).toBeNull()
  })
})

describe("citesOtherIn", () => {
  it("finds author-year and numbered markers, with the numbered one's reference", () => {
    expect(citesOtherIn("Reicherts et al. (2021) define proactive help (see also Kim and Lee, 2020).")).toEqual([
      { marker: "Reicherts et al. (2021)" },
      { marker: "(see also Kim and Lee, 2020)" },
    ])
    expect(citesOtherIn("Most participants preferred the agent [12].", TEXT)).toEqual([{ marker: "[12]", reference: "B. Author. Agents that read. CHI 2022." }])
    expect(citesOtherIn("Completion rose from 62% to 86% (n = 24).")).toEqual([])
  })
})
