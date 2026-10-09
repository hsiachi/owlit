import { docUri } from "@/features/docs/types"
import { isoDay, serializeTopic } from "../format"
import type { Change, Line, PaperKnowledge, Question, Ref, SourceEntry, TopicSidecar } from "../types"

// What Owlit would have kept so far from the seeded workspace (docs/mocks/seed.ts) and Library (p1–p8): a
// project on when a language model should reach for a tool. Passages are the papers' own words, found
// again in the PDFs by their opening and closing phrases.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.now()
const ago = (ms: number) => now - ms
const day = (d: number) => isoDay(ago(d * DAY))

const doc = (path: string, label = path.replace(/^.*\//, "").replace(/\.md$/, "")): Ref => ({ label, uri: docUri(path) })
const passage = (paperId: string, id: string, label: string): Ref => ({ label, uri: `owlit://library/${paperId}#passage=${id}` })
const abstract = (paperId: string): Ref => ({ label: "abstract", uri: `owlit://library/${paperId}#abstract` })
const paper = (paperId: string, label: string): Ref => ({ label, uri: `owlit://library/${paperId}` })

const HUNCH = "notes/Maybe retrieval and tool use are the same problem.md"
const ADVISOR = "meetings/Advisor meeting 10-02.md"
const EVAL = "experiments/Evaluation plan.md"
const PROPOSAL = "writing/Proposal draft.md"
const RELATED = "writing/Related work.md"
const TOOL_NOTES = "notes/Tool use reading notes.md"

interface SeedTopic {
  id: string
  name: string
  summary: string
  archived?: boolean
  modified: number
  lines: Line[]
  questions: Question[]
  sources: SourceEntry[]
  sidecar: TopicSidecar
}

let changeN = 0
const change = (d: number, what: string, why: string, lineId?: string, before?: string): Change => ({
  id: `seed-${++changeN}`,
  at: ago(d * DAY),
  lineId,
  what,
  why,
  by: "owlit",
  before,
})

const sidecar = (seenDaysAgo: number, changed: Record<string, number>, history: Change[]): TopicSidecar => ({
  seenAt: ago(seenDaysAgo * DAY),
  history,
  edits: {},
  removed: {},
  said: {},
  changedAt: Object.fromEntries(Object.entries(changed).map(([id, d]) => [id, ago(d * DAY)])),
})

const TOPICS: SeedTopic[] = [
  {
    id: "when-to-call",
    name: "When to call a tool",
    summary: "Toolformer learns when to call from its own samples, and ReAct decides while it reasons. Nobody has yet set either beside retrieval on the same questions.",
    modified: ago(1 * DAY),
    lines: [
      { id: "s1", speaker: "Schick 2023", text: "Toolformer keeps a call it sampled only when the result makes the next tokens easier to predict.", sources: [passage("p6", "tf-filter", "§2")], condition: "The calls are ones the model made up itself, not labelled by people." },
      { id: "s2", speaker: "Yao 2022", text: "ReAct looks things up to support its reasoning, and reasons to decide what to look up next.", sources: [passage("p7", "react-synergy", "§3")], condition: "On HotpotQA and FEVER, with a Wikipedia API." },
      { id: "s3", speaker: "You", text: "Retrieval and tool use may be the same problem: both decide when outside information beats what the weights already hold.", sources: [doc(HUNCH)] },
      { id: "s4", speaker: "You", verb: "reported", text: "The claim that no work compared learned calls with retrieval needs a search behind it.", sources: [doc(ADVISOR)] },
      { id: "s5", speaker: "Schick 2023", text: "Toolformer does not weigh what a call costs when deciding whether to make one.", sources: [passage("p6", "tf-cost", "Limitations")] },
      { id: "s6", speaker: "Owlit", text: "Counting unneeded calls, as your evaluation plan does, measures exactly what Toolformer leaves out.", sources: [doc(EVAL), passage("p6", "tf-cost", "Schick 2023")] },
    ],
    questions: [
      { id: "q1", text: "When should a language model reach for a tool instead of answering from memory?", sources: [doc(PROPOSAL)], status: "From your proposal draft. Schick 2023 and Yao 2022 each answer part of it. Still missing: either one set beside retrieval on the same questions." },
      { id: "q2", text: "Does it ever hurt to call a tool?", sources: [doc(TOOL_NOTES)], status: "From your Toolformer notes. Schick 2023 partly answers it: it ignores what a call costs." },
    ],
    sources: [
      { date: day(1), ref: doc(EVAL), how: "“unneeded calls” as a measure" },
      { date: day(3), ref: doc(PROPOSAL), how: "your question" },
      { date: day(4), ref: doc(HUNCH), how: "your hunch" },
      { date: day(6), ref: doc(ADVISOR), how: "your advisor’s point" },
      { date: day(6), ref: paper("p6", "Schick 2023"), how: "your notes on §2 and the limitations" },
      { date: day(6), ref: paper("p7", "Yao 2022"), how: "you read §3 and §4" },
    ],
    sidecar: sidecar(2, { s1: 6, s2: 6, s3: 4, s4: 6, s5: 1, s6: 1 }, [
      change(1, "Added", "your evaluation plan counts unneeded calls", "s6"),
      change(1, "Rewritten", "your notes ask whether a call can hurt", "s5", "Toolformer can’t use one tool’s output as another’s input."),
      change(4, "Added", "your note “Maybe retrieval and tool use are the same problem”", "s3"),
      change(6, "Added", "your advisor meeting notes", "s4"),
      change(6, "Topic started", "your Toolformer notes and ReAct §3–4"),
    ]),
  },
  {
    id: "retrieval",
    name: "Retrieval as outside memory",
    summary: "RAG keeps part of what a model knows in an index that can be swapped. Your hunch treats retrieval as one kind of tool call.",
    modified: ago(4 * DAY),
    lines: [
      { id: "s1", speaker: "Lewis 2020", text: "Swapping RAG’s index for a newer one changed its answers about world leaders without retraining.", sources: [passage("p4", "rag-swap", "§4.5")], condition: "For 82 world leaders who changed between 2016 and 2018." },
      { id: "s2", speaker: "You", text: "The trigger should look similar for both: uncertainty about a fact, not about reasoning.", sources: [doc(HUNCH)] },
      { id: "s3", speaker: "Owlit", text: "Your time-sensitive questions are where a swappable index should matter most.", sources: [doc(EVAL), passage("p4", "rag-swap", "Lewis 2020")] },
    ],
    questions: [],
    sources: [
      { date: day(3), ref: doc(EVAL), how: "questions whose answers change over time" },
      { date: day(4), ref: doc(HUNCH), how: "your hunch" },
      { date: day(9), ref: paper("p4", "Lewis 2020"), how: "cited in Related work" },
    ],
    sidecar: sidecar(3, { s1: 9, s2: 4, s3: 3 }, [
      change(3, "Added", "your evaluation plan", "s3"),
      change(4, "Topic started", "your note “Maybe retrieval and tool use are the same problem” and Lewis 2020"),
    ]),
  },
  {
    id: "reasoning",
    name: "Reasoning before acting",
    summary: "Writing out steps helps only in large models. Your related work reads that as a threshold; the scaling-laws paper reports smooth curves.",
    modified: ago(8 * DAY),
    lines: [
      { id: "s1", speaker: "Wei 2022", text: "Chain of thought helps only around 100B parameters; smaller models write fluent but illogical chains.", sources: [passage("p5", "cot-scale", "§3")], condition: "On arithmetic word problems such as GSM8K." },
      { id: "s2", speaker: "You", text: "The gains appear only at scale, once compute crosses a threshold.", sources: [doc(RELATED)] },
      { id: "s3", speaker: "Kaplan 2020", text: "Loss falls as a power law in model size, data and compute.", sources: [abstract("p8")] },
      { id: "s4", speaker: "Owlit", text: "Your related work cites the scaling-laws paper for a threshold, but it describes smooth power laws; the threshold comes from Wei 2022.", sources: [doc(RELATED), passage("p5", "cot-scale", "Wei 2022")] },
    ],
    questions: [{ id: "q1", text: "Is chain of thought itself a tool?", sources: [doc("Ideas.md")], status: "From your Ideas. Nothing answers it yet." }],
    sources: [
      { date: day(8), ref: doc(RELATED), how: "the paragraph on reasoning before acting" },
      { date: day(10), ref: doc("Ideas.md"), how: "your question" },
      { date: day(19), ref: paper("p8", "Kaplan 2020"), how: "cited in Related work; you read the compute figure" },
      { date: day(19), ref: paper("p5", "Wei 2022"), how: "cited in Related work" },
    ],
    sidecar: sidecar(7, { s1: 19, s2: 10, s3: 19, s4: 8 }, [
      change(8, "Added", "you cited Kaplan 2020 for a threshold", "s4"),
      change(10, "Topic started", "your related work and Ideas"),
    ]),
  },
  {
    id: "positional",
    name: "Positional encoding",
    summary: "Why sinusoids rather than learned positions. Set aside in September.",
    archived: true,
    modified: ago(25 * DAY),
    lines: [{ id: "s1", speaker: "You", text: "Reread the Transformer paper for its positional encoding section.", sources: [doc("notes/Reading log.md")] }],
    questions: [],
    sources: [{ date: day(25), ref: doc("notes/Reading log.md"), how: "your reading log" }],
    sidecar: sidecar(20, { s1: 25 }, [change(25, "Topic started", "your reading log")]),
  },
]

export const seedTopicFiles = TOPICS.map((t) => ({
  path: `knowledge/${t.name}.md`,
  content: serializeTopic({ id: t.id, name: t.name, summary: t.summary, archived: !!t.archived, lines: t.lines, questions: t.questions, sources: t.sources }),
  modifiedAt: t.modified,
}))

export const seedSidecars: Record<string, TopicSidecar> = Object.fromEntries(TOPICS.map((t) => [t.id, t.sidecar]))

// Passages from docs and chats that no topic holds. Nothing here needs doing.
export const seedLoose: { quote: string; ref: Ref }[] = [
  { quote: "A tool that says “I don’t know” instead of returning stale data", ref: doc("Ideas.md") },
  { quote: "Try the time-sensitive questions first, they make the case clearest", ref: doc(ADVISOR) },
  { quote: "Next meeting: bring one table, not slides", ref: doc(ADVISOR) },
  { quote: "Ask about compute budget", ref: doc(PROPOSAL) },
]

// ---- Papers ----

const P = (id: string, section: string, text: string, start: string, end: string, page?: number) => ({ id, section, text, start, end, page })

export const seedPapers: Record<string, PaperKnowledge> = {
  p6: {
    passages: Object.fromEntries(
      [
        P("tf-filter", "§2", "Intuitively, an API call is helpful to M if providing it with both the input and the output of this call makes it easier for the model to predict future tokens, compared to not receiving the API call at all, or receiving only its input.", "Intuitively, an API call is helpful", "or receiving only its input", 2),
        P("tf-retrieval", "§2", "How this is done depends entirely on the API itself – for example, it can involve calling another neural network, executing a Python script or using a retrieval system to perform search over a large corpus.", "How this is done depends entirely", "search over a large corpus", 2),
        P("tf-wording", "Limitations", "Beyond this, we found models trained with Toolformer to often be sensitive to the exact wording of their input when deciding whether or not to call an API.", "we found models trained with Toolformer", "whether or not to call an API", 10),
        P("tf-cost", "Limitations", "Finally, when deciding whether or not to make an API call, Toolformer currently does not take into account the tool-dependent, computational cost incurred from making an API call.", "Finally, when deciding whether", "incurred from making an API call", 10),
        P("tf-threshold", "Appendix A", "we only make API calls at positions where the probability of the <API> token is at least 5%, and we keep API calls if they reduce the loss by at least 1.0.", "we only make API calls at positions", "reduce the loss by at least 1.0", 14),
      ].map((p) => [p.id, p]),
    ),
    connections: [
      { id: "c1", kind: "challenges", have: { kind: "line", topicId: "retrieval", lineId: "s2" }, relation: "cuts against it: whether Toolformer calls an API turns on the exact wording of the input, not only on what it knows.", passageId: "tf-wording", createdAt: ago(4 * DAY) },
      { id: "c2", kind: "backs", have: { kind: "line", topicId: "when-to-call", lineId: "s3" }, relation: "backs it: Toolformer treats a retrieval system as one more API, sampled and filtered like the calculator.", passageId: "tf-retrieval", createdAt: ago(4 * DAY) },
      { id: "c3", kind: "backs", have: { kind: "question", topicId: "when-to-call", questionId: "q2" }, relation: "answers part of it: Toolformer never weighs what a call costs, so nothing stops a needless one.", passageId: "tf-cost", createdAt: ago(1 * DAY) },
      { id: "c4", kind: "might", have: { kind: "doc", path: EVAL, quote: "a setting wins if it lowers error without pushing $c$ past 0.3", at: ago(5 * HOUR) }, relation: "may touch it: Toolformer keeps a call only if it lowers the loss by at least 1.0, a threshold that could sit beside yours.", passageId: "tf-threshold", createdAt: ago(1 * HOUR) },
    ],
    dismissed: [],
    seenAt: ago(2 * DAY),
  },
  p7: {
    passages: Object.fromEntries(
      [
        P("react-synergy", "§3", "As shown in Figure 1(1d), by interacting with a Wikipedia API, ReAct is able to retrieve information to support reasoning, while also use reasoning to target what to retrieve next, demonstrating a synergy of reasoning and acting.", "by interacting with a Wikipedia API", "synergy of reasoning and acting", 3),
        P("react-both", "§1", "The best approach overall is a combination of ReAct and CoT that allows for the use of both internal knowledge and externally obtained information during reasoning.", "The best approach overall is", "obtained information during reasoning", 2),
        P("react-abstract", "abstract", "reasoning traces help the model induce, track, and update action plans as well as handle exceptions, while actions allow it to interface with external sources, such as knowledge bases or environments, to gather additional information.", "reasoning traces help the model", "to gather additional information", 0),
      ].map((p) => [p.id, p]),
    ),
    connections: [
      { id: "c1", kind: "challenges", have: { kind: "doc", path: RELATED, quote: "To our knowledge, no work has compared learned tool calls with retrieval on the same tasks.", at: ago(9 * DAY) }, relation: "cuts against it in part: ReAct already sets answering from memory beside looking things up, on the same HotpotQA and FEVER questions, though by prompting rather than learned calls.", passageId: "react-both", createdAt: ago(6 * DAY) },
      { id: "c2", kind: "backs", have: { kind: "question", topicId: "reasoning", questionId: "q1" }, relation: "answers part of it: here a thought and an action are separate steps that feed each other, so a thought is not a tool call.", passageId: "react-abstract", createdAt: ago(6 * DAY) },
    ],
    dismissed: [],
    seenAt: ago(6 * DAY),
  },
  p4: {
    passages: {
      "rag-swap": P("rag-swap", "§4.5", "RAG answers 70% correctly using the 2016 index for 2016 world leaders and 68% using the 2018 index for 2018 world leaders. Accuracy with mismatched indices is low (12% with the 2018 index and 2016 leaders, 4% with the 2016 index and 2018 leaders). This shows we can update RAG’s world knowledge by simply replacing its non-parametric memory.", "RAG answers 70% correctly", "by simply replacing its", 7),
    },
    connections: [
      { id: "c1", kind: "backs", have: { kind: "doc", path: ADVISOR, quote: "Try the time-sensitive questions first, they make the case clearest", at: ago(6 * DAY) }, relation: "backs it: swapping a 2016 index for a 2018 one changed RAG’s answers about world leaders, a ready-made time-sensitive case.", passageId: "rag-swap", createdAt: ago(4 * DAY) },
    ],
    dismissed: [],
    seenAt: ago(4 * DAY),
  },
  p5: {
    passages: {
      "cot-scale": P("cot-scale", "§3", "That is, chain-of-thought prompting does not positively impact performance for small models, and only yields performance gains when used with models of ∼100B parameters. We qualitatively found that models of smaller scale produced fluent but illogical chains of thought, leading to lower performance than standard prompting.", "does not positively impact performance", "lower performance than standard prompting", 3),
    },
    connections: [
      { id: "c1", kind: "backs", have: { kind: "line", topicId: "reasoning", lineId: "s2" }, relation: "backs it: chain of thought did nothing or hurt below roughly 100B parameters.", passageId: "cot-scale", createdAt: ago(10 * DAY) },
    ],
    dismissed: [],
    seenAt: ago(10 * DAY),
  },
  p8: {
    passages: {
      "kaplan-smooth": P("kaplan-smooth", "§1.1", "Smooth power laws: Performance has a power-law relationship with each of the three scale factors N, D, C when not bottlenecked by the other two, with trends spanning more than six orders of magnitude.", "Smooth power laws: Performance has", "bottlenecked by the other two", 2),
    },
    connections: [
      { id: "c1", kind: "challenges", have: { kind: "line", topicId: "reasoning", lineId: "s2" }, relation: "cuts against it: performance follows a smooth power law in each scale factor, with no threshold.", passageId: "kaplan-smooth", createdAt: ago(8 * DAY) },
    ],
    dismissed: [],
    seenAt: ago(19 * DAY),
    likely: { "reasoning/s3": "kaplan-smooth" },
  },
}
