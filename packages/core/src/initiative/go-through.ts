import { docUri } from "@owlit/protocol"
import { defineSkill } from "./skills.ts"

// Go through: Owlit reads what people said about the work (a meeting's transcript or minutes, reviews,
// someone's comments on a draft, an email of points, the user's own notes) against the user's docs, and
// writes down only what changes the work. Its answer is the reading, which core writes as a record
// beside the material, the material itself untouched below a link; the points it makes land as comments
// on the words of the docs they are about, carried over from the record. A summary says what the
// material contains; going through it says what the material changes. The paper-side twin is Digest.

// Where meeting records live by convention: a Meetings folder at the top of the workspace or in a project
export const MEETINGS = /(^|\/)Meetings\//
// The records Owlit writes there, named after the material ("… · reading", "… · 解读")
export const RECORD = / · (reading|解读)( \d+)?\.md$/
// What can be gone through: text
export const MATERIAL = /\.(md|markdown|txt)$/i

export interface GoThroughInput {
  // The material, as the workspace has it
  path: string
  content: string
  // Where the record will be, and its name, for the comments to point back to
  record: string
  recordLabel: string
  // The workspace's other Markdown docs, by path, to choose what the material is about
  docs: string[]
  // Today, as the record's date line says it
  today: string
}

// Long material is cut here: a 30-minute meeting's transcript is about a fifth of it
const MATERIAL_LIMIT = 120_000

export function goThroughPrompt(input: GoThroughInput) {
  const cut = input.content.length > MATERIAL_LIMIT
  const material = cut ? input.content.slice(0, MATERIAL_LIMIT) : input.content
  const recordLink = `[${input.recordLabel}](${docUri(input.record)})`
  return [
    `You are Owlit, going through material that comes from people (a meeting, reviews, someone's comments on a draft, an email of points, the user's own notes) against the user's docs. A summary says what the material contains; going through it says what it changes. You write down only what is new to the work, what differs from it, what was left open, what is owed, and what to look up. Everything that matches the work is dropped, in one closing clause.`,
    `The material is ${input.path}${cut ? " (cut short here; say so in the closing clause)" : ""}:\n\n<material>\n${material}\n</material>`,
    `First find the doc or docs it is about: the workspace's docs are ${input.docs.length ? input.docs.slice(0, 120).join(", ") : "(none)"}. Read the likely ones with docs_read. If none is about it, go through it against nothing: everything new is a point, and you leave no comments.`,
    `Keep the kinds of statement apart, and read the whole material before calling anything decided:
- Decided: someone agreed out loud, or nobody objected and the meeting moved on with it.
- Proposed: one person suggested it. Most things that sound like a decision are this.
- Asked: a question, answered or not.
- Mentioned: said in passing.
The test: would a reader come away thinking something was settled that was not? AI-written minutes fail it most often, writing every suggestion as decided (确定, 明确) and settling what was reopened later in the same meeting; where a transcript and minutes differ, the transcript wins.
Name a person only when the material names them; never guess a name from context (a minutes line "(来自 X)" is not evidence of who said it). Keep the speaker's key words and paraphrase the rest. Don't restate the doc, the material's own summary, or what matched; don't grade or count. Near the doc is not the same as the doc: near is a point, the same is dropped. When the speaker is the user (their own notes, or what they said in a meeting), say "you" (你).
Reviews are answered point by point, so for reviews nothing is dropped: every point is listed in the reviewer's own numbering, and one the doc already handles says where.`,
    `Your answer is the reading, plain Markdown in the material's language, and nothing else (no preamble, no code fence):

# <the material's title, e.g. "P5 小组周会 · 2026-10-15">

<who was there and what the material is, in one line, if it says>

## <"Owlit 的解读" or "Owlit's reading">

*<${input.today}> · <"对照" or "read against"> <the doc(s) you read it against, each as a link [name](owlit://docs/<path>)>*

<one lead sentence: what happened, naming who moved what>

### <要点 / Points>
- **<who>**: what was said that changes the work: either something differs from a doc (a framing, an order, a claim, a plan) or something new was settled that no doc says yet. Say what they said, who said it, and whether the user agreed on the spot; not what the doc should become.

### <待定 / Open>
- **<the question>** raised and not settled, or settled and then reopened: both sides, and who holds each.

### <待办 / To do>
- [ ] the user's items, and anything to look up (a paper, a dataset, a practice), as Markdown tasks
- **<who>**: others' items, one line each

<one closing clause: what matched the doc, briefly, including anything someone asked for that the doc already does, and transcription fixes ("overlap" read as Overleaf)>

Leave out a list with nothing in it. Six to eight items is many; with more, the material covers several docs: group the reading by doc. Your own view is never in the reading.`,
    `Then land each point and open question in the doc it is about, with docs_add_comment, on the exact words it is about (quote them word for word, a sentence or less; a point about something missing goes on the nearest heading):
- comment: who said what, in your words, mentioning the record as ${recordLink}, e.g. "时英天在 ${recordLink} 上建议……你当场同意了。" Never write in a speaker's name or voice.
- own: only when you have something to add of your own (where the doc already says it, what the point would break elsewhere, something in their library or a thread, a view worth having), one to three sentences; leave it out otherwise. A point in the user's own words usually has none.
Don't pre-write changes to the doc, and don't comment on the material itself. To-do items stay in the reading.`,
  ].join("\n\n")
}

export const goThroughSkill = defineSkill<GoThroughInput>({
  id: "meetings.goThrough",
  format: 1,
  lane: "agent",
  tools: /^(library_(search|related)|docs_add_comment)$/,
  writes: ["record", "comment"],
  instructions: goThroughPrompt,
})

// The reading as the agent answered it, without a code fence or words before its title
export function cleanReading(answer: string) {
  const fenced = /```(?:markdown|md)?\n([\s\S]*?)```/.exec(answer)
  const text = (fenced?.[1] ?? answer).trim()
  const start = text.search(/^# /m)
  return (start > 0 ? text.slice(start) : text).trim()
}

// The record: the reading, then the material it read, by link (it stays as it was, where it is)
export function recordOf(reading: string, material: string, chinese: boolean) {
  const name = material.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "")
  return `${reading}\n\n---\n\n## ${chinese ? "原文" : "The material"}\n\n- [${name}](${docUri(material)})\n`
}

// Material in Chinese gets its record named and headed in Chinese
export function isChinese(text: string) {
  const sample = text.slice(0, 4000)
  const han = sample.match(/[一-鿿]/g)?.length ?? 0
  const latin = sample.match(/[A-Za-z]/g)?.length ?? 0
  return han > latin
}
