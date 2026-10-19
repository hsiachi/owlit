import { WEB_ME, WEB_OWLIT } from "@/lib/actors"
import type { DocComment, WorkspaceFile } from "../types"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.now()
const ago = (ms: number) => now - ms

// A small workspace about tool use in language models. Citations point at the Library's mock papers p1–p8, and
// p12, one Owlit added that nobody opened (drawn lighter)
const relatedWork = `# Related work

## Reasoning before acting

Prompting a model to write out intermediate steps improves multi-step problems without any training [Wei et al. 2022](owlit://library/p5). The gains appear only at scale, which fits the broader picture from [Kaplan et al. 2020](owlit://library/p8): capabilities that look absent in small models show up once compute crosses a threshold.

## Acting with tools

[Yao et al. 2022](owlit://library/p7) interleave reasoning traces with actions, so the model can look things up mid-thought instead of guessing. [Schick et al. 2023](owlit://library/p6) go further and let the model decide *when* to call an API, learning this from its own filtered samples.

Retrieval is the oldest form of this idea. [Lewis et al. 2020](owlit://library/p4#p2 "We endow pre-trained, parametric-memory generation models with a non-parametric memory.") attach a dense retriever to a generator and train them together; the model's knowledge then lives partly outside its weights. Reading tools take the same turn ([Lo et al. 2024](owlit://library/p12)).

To our knowledge, no work has compared learned tool calls with retrieval on the same tasks.
`

const proposal = `# Proposal draft

**Question.** When should a language model reach for a tool instead of answering from memory?

**Why now.** Few-shot prompting made it cheap to try new behaviours [Brown et al. 2020](owlit://library/p2), and instruction tuning made models follow them reliably [Ouyang et al. 2022](owlit://library/p3).

## Plan

1. Collect questions where the answer changes over time
2. Compare three settings: no tools, retrieval only, learned tool calls
3. Measure accuracy and how often the model calls a tool it didn't need

- [x] Pick the question set
- [ ] Ask about compute budget
- [ ] Draft the evaluation section
`

const toolNotes = `# Tool use reading notes

> The model decides which APIs to call, when to call them, what arguments to pass, and how to best incorporate the results.

That sentence is the whole pitch of [Schick et al. 2023](owlit://library/p6). Things to check:

- How do they filter the self-generated calls? Loss reduction on the next tokens.
- Does it ever *hurt* to call a tool? They report it on some tasks.
- Compare with [Yao et al. 2022](owlit://library/p7), where the trace is written by prompting, not learned.

\`\`\`text
[Calculator(400 / 1400) → 0.29]
\`\`\`
`

const readingLog = `---
tags: [log]
started: 2026-09-14
---
Reading log

- 09-14 · Attention Is All You Need, again for the positional encoding section
- 09-20 · Scaling laws: the compute-optimal frontier figure
- 10-03 · ReAct, sections 3 and 4
`

const hunch = `Maybe retrieval and tool use are the same problem

Both decide when outside information beats what the weights already hold. If that's right, the trigger should look similar in both: uncertainty about a fact, not about reasoning.
`

const advisor = `# Advisor meeting 10-02

- Narrow the claim in related work: "no work compared" needs a search behind it
- Try the time-sensitive questions first, they make the case clearest
- Next meeting: bring one table, not slides
`

const ideas = `# Ideas

- A tool that says "I don't know" instead of returning stale data
- Measure tool calls per correct answer, not just accuracy
- ==Ask: is chain of thought itself a tool?==
- Follow up on [Maybe retrieval and tool use are the same problem](owlit://docs/notes/Maybe%20retrieval%20and%20tool%20use%20are%20the%20same%20problem.md)
`

const evaluation = `# Evaluation plan

> [!note] Scope
> Questions whose answers change over time, so memory alone can't be right.

| Setting | Tools | What we measure |
| --- | --- | --- |
| Baseline | none | accuracy |
| Retrieval | search index | accuracy, calls per answer |
| Learned calls | [Schick et al. 2023](owlit://library/p6#p3 "The model decides which APIs to call, when to call them, what arguments to pass.") | accuracy, **unneeded** calls |

The cost of a call is $c = t_{call} / t_{answer}$; a setting wins if it lowers error without pushing $c$ past 0.3.

$$
\\text{score} = \\text{accuracy} - \\lambda \\cdot \\text{unneeded calls}
$$

Background in [[Related work]] and [[Tool use reading notes|my reading notes]]. Sketch: ![[react-trace.png]]

Budget: about $5 per run, $10 at most.
`

export const seedFiles: WorkspaceFile[] = [
  { id: "d1", path: "writing/Related work.md", content: relatedWork, createdAt: ago(9 * DAY), modifiedAt: ago(2 * HOUR), nameLocked: true },
  { id: "d2", path: "writing/Proposal draft.md", content: proposal, createdAt: ago(20 * DAY), modifiedAt: ago(3 * DAY), nameLocked: true },
  { id: "d3", path: "notes/Tool use reading notes.md", content: toolNotes, createdAt: ago(6 * DAY), modifiedAt: ago(1 * DAY) },
  { id: "d4", path: "notes/Reading log.md", content: readingLog, createdAt: ago(24 * DAY), modifiedAt: ago(5 * DAY), nameLocked: true },
  { id: "d5", path: "notes/Maybe retrieval and tool use are the same problem.md", content: hunch, createdAt: ago(4 * DAY), modifiedAt: ago(4 * DAY) },
  { id: "d6", path: "notes/react-trace.png", createdAt: ago(7 * DAY), modifiedAt: ago(7 * DAY) },
  { id: "d7", path: "meetings/Advisor meeting 10-02.md", content: advisor, createdAt: ago(6 * DAY), modifiedAt: ago(6 * DAY), nameLocked: true },
  { id: "d9", path: "experiments/Evaluation plan.md", content: evaluation, createdAt: ago(3 * DAY), modifiedAt: ago(5 * HOUR), nameLocked: true },
  { id: "d8", path: "Ideas.md", content: ideas, createdAt: ago(30 * DAY), modifiedAt: ago(10 * DAY), nameLocked: true },
]

export const seedFolders = ["writing", "notes", "meetings", "experiments"]

// Notes an agent left on the draft, as if from an earlier review: one on a sentence inside a paragraph, one
// on the closing overclaim
export const seedComments: Record<string, DocComment[]> = {
  d1: [
    {
      id: "n2",
      quote: "The gains appear only at scale",
      prefix: "(owlit://library/p5). ",
      suffix: ", which fits the broader",
      entries: [
        {
          id: "n2-1",
          by: WEB_OWLIT,
          agent: "Claude Code",
          text: "“Only” is stronger than the paper: the threshold varies by task. “Mostly at scale” would hold, or cite a second source.",
          at: ago(2 * DAY + HOUR),
        },
        { id: "n2-2", by: WEB_ME, text: "Which tasks break the pattern?", at: ago(DAY) },
      ],
      createdAt: ago(2 * DAY + HOUR),
    },
    {
      id: "n1",
      quote: "To our knowledge, no work has compared learned tool calls with retrieval on the same tasks.",
      prefix: "partly outside its weights.\n\n",
      suffix: "\n",
      entries: [
        {
          id: "n1-1",
          by: WEB_OWLIT,
          agent: "Claude Code",
          text: "\u201cNo work has compared\u201d goes further than your reading can show. Narrow it to the studies you've read, or search further before you submit.",
          at: ago(2 * DAY),
        },
      ],
      createdAt: ago(2 * DAY),
    },
  ],
}
