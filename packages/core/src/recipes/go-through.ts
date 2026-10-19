import { docUri } from "@owlit/protocol"
import type { Recipe } from "./index.ts"

// Go through: Owlit reads what people said about the work (a meeting's transcript or minutes, reviews,
// someone's comments on a draft, an email of points, the user's own notes) against the user's docs, and
// writes down only what changes the work. It writes the reading as a record of its own beside the
// material, the material itself untouched below a link, then lands the points as comments on the words
// of the docs they are about, each pointing back to the record. A summary says what the material
// contains; going through it says what the material changes. The paper-side twin is the digest.

// Where meeting records live by convention: a Meetings folder at the top of the workspace or in a project
export const MEETINGS = /(^|\/)Meetings\//
// Where the record of material that isn't among the docs (a file attached to a chat) goes
export const MEETINGS_FOLDER = "Meetings"
// What can be gone through: text
export const MATERIAL = /\.(md|markdown|txt)$/i

export interface GoThroughInput {
  // The material, as the workspace has it; its text follows the recipe in the same message
  path: string
  // The material's text was cut short
  cut?: boolean
  // Where the record is to be written (a new doc), and its name, for the comments to point back to
  record: string
  recordLabel: string
  // The link to the material at the foot of the record: the doc, or the chat a file was attached to
  materialLink: string
  // The material is in Chinese: the record's headings are too
  chinese: boolean
  // The workspace's other Markdown docs, by path, to choose what the material is about
  docs: string[]
  // Today, as the record's date line says it
  today: string
  // The user's name (Settings › Owlit › Your name), so their own words become "you"
  user?: string
}

// Without an input (owlit_help), the recipe says how to find what core would otherwise give: the
// material the user named, the docs, the record's place
export function goThroughRecipe(input?: GoThroughInput) {
  const recordLink = input ? `[${input.recordLabel}](${docUri(input.record)})` : "[<the record's name>](owlit://docs/<the record's path>)"
  const name = input ? input.path.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "") : "<the material's name>"
  return [
    `You are Owlit, going through material that comes from people (a meeting, reviews, someone's comments on a draft, an email of points, the user's own notes) against the user's docs. A summary says what the material contains; going through it says what it changes. You write down only what is new to the work, what differs from it, what was left open, what is owed, and what to look up. Everything that matches the work is dropped, in one closing clause.`,
    input
      ? `The material is ${input.path}; its text follows these instructions${input.cut ? " (cut short there; say so in the closing clause)" : ""}.`
      : `The material is the file the user named: read it whole with docs_read (a file attached to the chat is in .owlit/chats/<chat id>/files/).`,
    input?.user
      ? `The user is ${input.user}. What ${input.user} said is the user's own: write "you" (你), never their name, and their to-dos are the user's tasks.`
      : `If you don't know the user's name and one speaker is plainly the user (the docs are theirs, they present them), write that speaker as "you" (你); otherwise name every speaker.`,
    `First find the doc or docs it is about: ${input ? `the workspace's docs are ${input.docs.length ? input.docs.slice(0, 120).join(", ") : "(none)"}` : "docs_list lists the workspace's docs"}. Read the likely ones with docs_read. If none is about it, go through it against nothing: everything new is a point, and you leave no comments.`,
    `Keep the kinds of statement apart, and read the whole material before calling anything decided:
- Decided: someone agreed out loud, or nobody objected and the meeting moved on with it.
- Proposed: one person suggested it. Most things that sound like a decision are this.
- Asked: a question, answered or not.
- Mentioned: said in passing.
The test: would a reader come away thinking something was settled that was not? AI-written minutes fail it most often, writing every suggestion as decided (确定, 明确) and settling what was reopened later in the same meeting; where a transcript and minutes differ, the transcript wins.
Name a person only when the material names them; never guess a name from context (a minutes line "(来自 X)" is not evidence of who said it). Keep the speaker's key words and paraphrase the rest. Don't restate the doc, the material's own summary, or what matched; don't grade or count. Near the doc is not the same as the doc: near is a point, the same is dropped. When the speaker is the user (their own notes, or what they said in a meeting), say "you" (你).
Reviews are answered point by point, so for reviews nothing is dropped: every point is listed in the reviewer's own numbering, and one the doc already handles says where.`,
    `Write the reading first, as a new doc of your own with docs_write at ${input ? input.record : `the material's folder, named after it with " · reading" (" · 解读" for material in Chinese), e.g. "Meetings/Weekly · reading.md"; a file attached to the chat gets its record in Meetings/`}. It is plain Markdown in the material's language:

# <the material's title, e.g. "P5 小组周会 · 2026-10-15">

<who was there and what the material is, in one line, if it says>

## ${input ? (input.chinese ? "Owlit 的解读" : "Owlit's reading") : `<"Owlit 的解读" or "Owlit's reading">`}

*${input ? input.today : "<today>"} · ${input ? (input.chinese ? "对照" : "read against") : `<"对照" or "read against">`} <the doc(s) you read it against, each as a link [name](owlit://docs/<path>)>*

<one lead sentence: what happened, naming who moved what>

### <要点 / Points>
- **<who>**: what was said that changes the work: either something differs from a doc (a framing, an order, a claim, a plan) or something new was settled that no doc says yet. Say what they said, who said it, and whether the user agreed on the spot; not what the doc should become.

### <待定 / Open>
- **<the question>** raised and not settled, or settled and then reopened: both sides, and who holds each.

### <待办 / To do>
- [ ] the user's items, and anything to look up (a paper, a dataset, a practice), as Markdown tasks
- **<who>**: others' items, one line each

<one closing clause: what matched the doc, briefly, including anything someone asked for that the doc already does, and transcription fixes ("overlap" read as Overleaf)>

---

## ${input ? (input.chinese ? "原文" : "The material") : `<"原文" or "The material">`}

- [${name}](${input ? input.materialLink : "owlit://docs/<the material's path>"})

Leave out a list with nothing in it. Six to eight items is many; with more, the material covers several docs: group the reading by doc. Your own view is never in the reading. The material itself stays as it is: the record only links to it.`,
    `Then, once the record is written (the comments point back to it, so owlit takes none before it), land each point and open question in the doc it is about, with docs_add_comment, on the exact words it is about (quote them word for word, a sentence or less; a point about something missing goes on the nearest heading):
- comment: who said what, in your words, mentioning the record as ${recordLink}, e.g. "时英天在 ${recordLink} 上建议……你当场同意了。" Never write in a speaker's name or voice.
- own: only when you have something to add of your own (where the doc already says it, what the point would break elsewhere, something in their library or a thread, a view worth having), one to three sentences; leave it out otherwise. A point in the user's own words usually has none.
- A paper you name in either is cited with the sentence it rests on as the link's title, word for word from library_read: [Author Year](owlit://library/<id>#p<page> "sentence").
Don't pre-write changes to the doc, and don't comment on the material itself. To-do items stay in the reading.`,
    `Change nothing else: not the material, not the user's docs, and add nothing to the library. When you are done, say in one line what you wrote; the record and the comments are the work.`,
  ].join("\n\n")
}

export const goThrough: Recipe<GoThroughInput | undefined> = {
  about: "doc",
  description: "go through material from people (a meeting's transcript or minutes, reviews, someone's comments, an email of points) against the user's docs: a reading of what it changes as a record beside it, its points as comments on the docs (no thread)",
  text: goThroughRecipe,
}

// Material in Chinese gets its record named and headed in Chinese
export function isChinese(text: string) {
  const sample = text.slice(0, 4000)
  const han = sample.match(/[一-鿿]/g)?.length ?? 0
  const latin = sample.match(/[A-Za-z]/g)?.length ?? 0
  return han > latin
}
