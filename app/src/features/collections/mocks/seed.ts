import { QUESTION_COLUMN, type Collection, type CollectionPaper, type CollectionRow } from "@owlit/protocol"
import { DAY, HOUR } from "@/lib/time"

// Collections for the browser preview. Most rows are papers of the Library's mock seed (p1…), as a paper
// Owlit found and the user went on to read would be; a few are papers Owlit only found, which live on the
// collection alone.

const now = Date.now()

const lib = (title: string, authors: string[], year: number, venue?: string): CollectionPaper => ({ title, authors, ids: {}, year, ...(venue ? { venue } : {}) })

function row(id: string, paper: CollectionPaper, answer: string, depth: "abstract" | "full", at: number, passage?: { quote: string; page: number }): CollectionRow {
  return { id, paper, cells: { [QUESTION_COLUMN]: { text: answer, depth, at, ...(passage ? { passage } : {}) } }, addedAt: at, foundBy: "search" }
}

function readingTools(): Collection {
  const at = now - 2 * HOUR
  const asked = "What tools help people read papers faster? Anything I should look at for the study?"
  return {
    version: 1,
    id: "reading-support-tools",
    title: "Tools that support reading scientific papers",
    asked: { text: asked, chatId: "c1", at },
    project: "Reading tools study",
    sources: ["Semantic Scholar", "OpenAlex"],
    memo: [
      { id: "s1", text: "Most tools add context inside the paper itself: [CiteSee](owlit://library/p9) marks citations the reader has seen, [Scim](owlit://library/p15) highlights a paper's key sentences." },
      { id: "s2", text: "Two systems work across papers rather than within one: [Synergi](owlit://library/p10) builds a thread of related work from a seed citation, [Relatedly](owlit://library/p11) from existing related-work sections." },
      { id: "s3", text: "Evaluations are short lab studies; none followed readers over weeks, and none measured reading speed directly." },
    ],
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [
      row("p9", lib("CiteSee: Augmenting Citations in Scientific Papers with Persistent and Personalized Historical Context", ["Joseph Chee Chang", "Amy X. Zhang"], 2023, "CHI"), "Marks citations the reader has already seen or saved, so familiar work stands out while reading.", "full", at, { quote: "personalized and persistent citation context", page: 2 }),
      row("p15", lib("Scim: Intelligent Skimming Support for Scientific Papers", ["Raymond Fok", "Hita Kambhamettu"], 2023, "IUI"), "Highlights a paper's objective, method and result sentences in different colours to guide skimming.", "abstract", at),
      row("p10", lib("Synergi: A Mixed-Initiative System for Scholarly Synthesis and Sensemaking", ["Hyeonsu B. Kang", "Sherry Tongshuang Wu"], 2023, "UIST"), "Builds a hierarchy of related work from a citation the user picks, mixing the user's choices with an LLM's.", "full", at, { quote: "threads of related work", page: 4 }),
      row("p11", lib("Relatedly: Scaffolding Literature Reviews with Existing Related Work Sections", ["Srishti Palani", "Aakanksha Naik"], 2023, "CHI"), "Reuses related-work sections of other papers as a map of a topic, with the papers each one cites.", "abstract", at),
      row("p12", lib("The Semantic Reader Project", ["Kyle Lo", "Joseph Chee Chang"], 2024, "CACM"), "An overview of reading interfaces built on one PDF reader; most were tested with fewer than twenty readers.", "abstract", at),
      row(
        "doi-10.1145-3526113.3545660",
        { title: "Threddy: An Interactive System for Personalized Thread-based Exploration and Organization of Scientific Literature", authors: ["Hyeonsu B. Kang", "Joseph Chee Chang"], ids: { doi: "10.1145/3526113.3545660" }, year: 2022, venue: "UIST", abstract: "Reviewing the literature to understand relevant threads of past work is a critical part of research. Threddy lets researchers extract threads of related work from the papers they read and organize them as they go." },
        "Lets readers pull threads of related work out of papers as they read and keep them organised.",
        "abstract",
        now - 30 * 60_000,
      ),
      row(
        "doi-10.1145-3589955",
        { title: "Paper Plain: Making Medical Research Papers Approachable to Healthcare Consumers", authors: ["Tal August", "Lucy Lu Wang"], ids: { doi: "10.1145/3589955" }, year: 2023, venue: "TOCHI", abstract: "Paper Plain adds plain-language summaries and guiding questions to medical papers for readers outside the field." },
        "Adds plain-language section summaries for readers outside the field; readers found papers easier but not faster to read.",
        "abstract",
        now - 30 * 60_000,
      ),
    ],
    groups: [],
    watch: false,
    createdAt: at,
    updatedAt: now - 30 * 60_000,
    // The two papers Owlit added later carry the dot until the user looks
    changedAt: { "row:doi-10.1145-3526113.3545660": now - 30 * 60_000, "row:doi-10.1145-3589955": now - 30 * 60_000, "memo:s3": now - 30 * 60_000 },
    seenAt: at + 60_000,
    yours: { edits: { "memo:s3": { text: "Evaluations are short lab studies; none followed readers over weeks, and none measured reading speed directly.", at: now - 20 * 60_000, was: "Evaluations are short lab studies; none followed readers over weeks." } }, removed: {} },
  }
}

function toolUse(): Collection {
  const at = now - 3 * DAY
  const asked = "find papers on language models that call tools or act in an environment"
  return {
    version: 1,
    id: "llm-tool-use",
    title: "Language models that use tools",
    asked: { text: asked, chatId: "c2", at },
    project: "",
    sources: ["arXiv", "Semantic Scholar"],
    memo: [
      { id: "s1", text: "[ReAct](owlit://library/p7) interleaves reasoning steps with actions; [Toolformer](owlit://library/p6) teaches a model when to call an API from its own samples." },
      { id: "s2", text: "[Chain-of-thought](owlit://library/p5) prompting underlies both: the reasoning steps are what decide the next action." },
    ],
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [
      row("p7", lib("ReAct: Synergizing Reasoning and Acting in Language Models", ["Shunyu Yao", "Jeffrey Zhao"], 2023, "ICLR"), "Alternates thoughts and actions in one trace; beats acting alone on question answering and web tasks.", "full", at, { quote: "interleaved manner", page: 1 }),
      row("p6", lib("Toolformer: Language Models Can Teach Themselves to Use Tools", ["Timo Schick", "Jane Dwivedi-Yu"], 2023, "NeurIPS"), "Fine-tunes a model on its own API calls that helped predict the next tokens, with no human labels.", "abstract", at),
      row("p5", lib("Chain-of-Thought Prompting Elicits Reasoning in Large Language Models", ["Jason Wei", "Xuezhi Wang"], 2022, "NeurIPS"), "Showing worked steps in the prompt makes large models reason step by step.", "abstract", at),
      row("p14", lib("Generative Agents: Interactive Simulacra of Human Behavior", ["Joon Sung Park", "Joseph C. O'Brien"], 2023, "UIST"), "Agents act in a sandbox from a memory of observations they retrieve and reflect on.", "abstract", at),
    ],
    groups: [],
    watch: true,
    createdAt: at,
    updatedAt: at,
    changedAt: {},
    seenAt: at + HOUR,
    yours: { edits: {}, removed: {} },
  }
}

function nothingFound(): Collection {
  const at = now - 9 * DAY
  const asked = "has anyone compared replay ratings with live ratings of reminders?"
  return {
    version: 1,
    id: "replay-vs-live-ratings",
    title: "Replay versus live ratings of reminders",
    asked: { text: asked, chatId: "c3", at },
    project: "Reading tools study",
    sources: ["Semantic Scholar", "OpenAlex", "arXiv"],
    memo: [{ id: "s1", text: "Found nothing that compares the two directly; the closest work compares diaries with experience sampling." }],
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [],
    groups: [],
    watch: false,
    createdAt: at,
    updatedAt: at,
    changedAt: {},
    seenAt: at,
    yours: { edits: {}, removed: {} },
  }
}

export const seedCollections = (): Record<string, Collection> => Object.fromEntries([readingTools(), toolUse(), nothingFound()].map((c) => [c.id, c]))
