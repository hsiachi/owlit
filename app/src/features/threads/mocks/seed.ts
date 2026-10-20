import { type AnswerDepth, GROUPING_COLUMN, QUESTION_COLUMN, type ThreadRead, type ThreadPaper, type ThreadRowRead } from "@owlit/protocol"
import { DAY, HOUR } from "@/lib/time"

// Threads for the browser preview, as core gives them out: each row with its paper's facts. Most rows are
// papers of the Library's mock seed (p1…); the preview's Library lacks a few of the others.

const now = Date.now()

const lib = (title: string, authors: string[], year: number, venue?: string): ThreadPaper => ({ title, authors, ids: {}, year, ...(venue ? { venue } : {}) })

function row(id: string, paper: ThreadPaper, answer: string, depth: AnswerDepth, at: number, passage?: { quote: string; page: number }): ThreadRowRead {
  return { id, paper, cells: { [QUESTION_COLUMN]: { text: answer, depth, at, ...(passage ? { passage } : {}) } }, addedAt: Math.min(at, now - 2 * HOUR), foundBy: "search" }
}

function readingTools(): ThreadRead {
  const at = now - 2 * HOUR
  const asked = "What tools help people read papers faster? Anything I should look at for the study?"
  return {
    version: 3,
    id: "reading-support-tools",
    title: "Tools that support reading scientific papers",
    asked: { text: asked, chatId: "c1", at },
    project: "Reading tools study",
    sources: ["Semantic Scholar", "OpenAlex"],
    report: "Most tools add context inside the paper itself: [CiteSee](owlit://library/p9) marks citations the reader has seen, [Scim](owlit://library/p15) highlights a paper's key sentences. Two systems work across papers rather than within one: [Synergi](owlit://library/p10) builds a thread of related work from a seed citation, [Relatedly](owlit://library/p11) from existing related-work sections. Evaluations are short lab studies; none followed readers over weeks, and none measured reading speed directly.",
    one: "Most tools add context inside the paper itself: CiteSee marks citations the reader has seen, Scim highlights a paper's key sentences.",
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [
      row("p9", lib("CiteSee: Augmenting Citations in Scientific Papers with Persistent and Personalized Historical Context", ["Joseph Chee Chang", "Amy X. Zhang"], 2023, "CHI"), "Marks citations the reader has already seen or saved, so familiar work stands out while reading.", "full", at, { quote: "personalized and persistent citation context", page: 2 }),
      // Answered again from the full text after the user asked for the thread to be read in full (the
      // preview's change log has the answer it replaced)
      row("p15", lib("Scim: Intelligent Skimming Support for Scientific Papers", ["Raymond Fok", "Hita Kambhamettu"], 2023, "IUI"), "Highlights objective, method and result sentences in four colours; readers skimmed faster with no loss of recall.", "full", now - 25 * 60_000, { quote: "faceted highlights", page: 3 }),
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
      // A paper whose source gave no abstract: answered from its title only
      row(
        "doi-10.1145-3613904.3642000",
        { title: "Skim Reading with Guided Highlights on Mobile", authors: ["Mina Lee"], ids: { doi: "10.1145/3613904.3642000" }, year: 2024, venue: "CHI" },
        "Seems to bring guided highlights to skimming on phones.",
        "title",
        at,
      ),
    ],
    createdAt: at,
    updatedAt: now - 30 * 60_000,
  }
}

function toolUse(): ThreadRead {
  const at = now - 3 * DAY
  const asked = "find papers on language models that call tools or act in an environment"
  return {
    version: 3,
    id: "llm-tool-use",
    title: "Language models that use tools",
    asked: { text: asked, chatId: "c2", at },
    project: "",
    sources: ["arXiv", "Semantic Scholar"],
    report: "[ReAct](owlit://library/p7) interleaves reasoning steps with actions; [Toolformer](owlit://library/p6) teaches a model when to call an API from its own samples. [Chain-of-thought](owlit://library/p5) prompting underlies both: the reasoning steps are what decide the next action.",
    one: "ReAct interleaves reasoning steps with actions; Toolformer teaches a model when to call an API from its own samples.",
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [
      row("p7", lib("ReAct: Synergizing Reasoning and Acting in Language Models", ["Shunyu Yao", "Jeffrey Zhao"], 2023, "ICLR"), "Alternates thoughts and actions in one trace; beats acting alone on question answering and web tasks.", "full", at, { quote: "interleaved manner", page: 1 }),
      row("p6", lib("Toolformer: Language Models Can Teach Themselves to Use Tools", ["Timo Schick", "Jane Dwivedi-Yu"], 2023, "NeurIPS"), "Fine-tunes a model on its own API calls that helped predict the next tokens, with no human labels.", "abstract", at),
      row("p5", lib("Chain-of-Thought Prompting Elicits Reasoning in Large Language Models", ["Jason Wei", "Xuezhi Wang"], 2022, "NeurIPS"), "Showing worked steps in the prompt makes large models reason step by step.", "abstract", at),
      row("p14", lib("Generative Agents: Interactive Simulacra of Human Behavior", ["Joon Sung Park", "Joseph C. O'Brien"], 2023, "UIST"), "Agents act in a sandbox from a memory of observations they retrieve and reflect on.", "abstract", at),
    ],
    createdAt: at,
    updatedAt: at,
  }
}

function nothingFound(): ThreadRead {
  const at = now - 9 * DAY
  const asked = "has anyone compared replay ratings with live ratings of reminders?"
  return {
    version: 3,
    id: "replay-vs-live-ratings",
    title: "Replay versus live ratings of reminders",
    asked: { text: asked, chatId: "c3", at },
    project: "Reading tools study",
    sources: ["Semantic Scholar", "OpenAlex", "arXiv"],
    report: "Found nothing that compares the two directly; the closest work compares diaries with experience sampling.",
    one: "Found nothing that compares the two directly; the closest work compares diaries with experience sampling.",
    columns: [{ id: QUESTION_COLUMN, question: asked, kind: "ask" }],
    rows: [],
    createdAt: at,
    updatedAt: at,
  }
}

// A bigger thread with columns and groups, as Owlit gathers for a venue. Sample rows for the preview,
// not a real proceedings list; like a proceedings listing they have no abstracts, so what isn't from the
// full text is from the title only.
function venue(): ThreadRead {
  const at = now - 26 * HOUR
  const asked = "UIST 2026 papers: which ones touch my reading-tools study?"
  const p = (id: string, title: string, authors: string[], answer: string, method: string, rel?: { rel: "supports" | "challenges" | "related"; sentence: string; text: string }, group?: string, full?: { quote: string; page: number }): ThreadRowRead => ({
    id,
    paper: { title, authors, ids: { doi: `10.1145/${id}` }, year: 2026, venue: "UIST" },
    is: method.startsWith("Survey") ? "Survey paper" : method.startsWith("Technical") ? "Technical paper" : "System paper with a study",
    cells: {
      [QUESTION_COLUMN]: { text: answer, depth: full ? "full" : "title", at, ...(full ? { passage: full } : {}) },
      c2: { text: method, depth: full ? "full" : "title", at },
      ...(rel ? { c3: { text: rel.text, rel: rel.rel, sentence: rel.sentence, depth: "title" as const, at } } : { c3: { text: "No bearing", depth: "title" as const, at } }),
    },
    addedAt: at,
    ...(group ? { in: { [GROUPING_COLUMN]: [group] } } : {}),
  })
  return {
    version: 3,
    id: "uist-2026-papers",
    title: "UIST 2026 papers",
    asked: { text: asked, at },
    project: "Reading tools study",
    sources: ["ACM DL proceedings"],
    report: "The largest group builds reading and writing aids that act inside the document; most add context at the moment of reading rather than before it. Evaluations are lab sessions of under an hour; two of nine report reading time, and both find no speed-up.",
    one: "The largest group builds reading and writing aids that act inside the document; most add context at the moment of reading rather than before it.",
    columns: [
      { id: QUESTION_COLUMN, question: asked, kind: "ask" },
      { id: "c2", question: "Method and sample", kind: "ask" },
      { id: "c3", question: "notes/Reading log.md", kind: "compare", doc: "notes/Reading log.md", sentences: [{ id: "l1", text: "Context shown while reading helps more than a summary before it." }, { id: "l2", text: "Faster reading is the wrong goal for scholarly tools." }] },
      {
        id: GROUPING_COLUMN,
        question: "Topic",
        kind: "grouping",
        hidden: true,
        groups: [
          { id: "reading", name: "Reading and writing aids", one: "tools that act inside or across papers" },
          { id: "inside", name: "Inside one paper", one: "context, summaries, figures", parent: "reading" },
          { id: "across", name: "Across papers", one: "arguments, threads, speed", parent: "reading" },
          { id: "other", name: "Other topics", one: "fabrication, haptics, XR input" },
        ],
      },
    ],
    rows: [
      // Answered again from the full text (the preview's change log has the answer it replaced)
      p("u1", "MarginNotes: Inline Context for Citations While Reading", ["Ana Ruiz", "Kai Chen"], "Inline citation cards cut lookups by half and readers kept their place.", "Lab study, N = 16", { rel: "supports", sentence: "l1", text: "context in place beats leaving the page" }, "inside", { quote: "readers returned to the citing sentence in 94% of lookups", page: 6 }),
      p("u2", "Skimlets: Pre-reading Summaries for Long Papers", ["Ola Nord"], "A summary shown before reading sped up skimming but lowered recall of methods.", "Within-subjects, N = 24", { rel: "challenges", sentence: "l1", text: "a summary before reading also helped" }, "inside"),
      p("u3", "Threadline: Following an Argument Across Papers", ["Ming Li", "Sara Holt"], "Linking claims across papers helped readers trace an argument's history.", "Field deployment, 3 weeks, N = 9", { rel: "related", sentence: "l2", text: "measures understanding, not speed" }, "across"),
      p("u4", "Why Faster Isn't Better: Reading Speed in Scholarly Tools", ["Rui Costa"], "Readers given speed aids reported less understanding; the authors argue speed is the wrong target.", "Survey, N = 210", { rel: "supports", sentence: "l2", text: "argues the same point from survey data" }, "across"),
      p("u5", "LensPDF: Semantic Zoom for Figures and Tables", ["Priya Nair"], "Zooming into a figure's data cut time on figure questions by a third.", "Lab study, N = 20", undefined, "inside"),
      p("u6", "Handoff: Haptic Cues for Mixed-Reality Typing", ["Jonas Berg"], "Haptic cues raised typing accuracy in mixed reality.", "Lab study, N = 18", undefined, "other"),
      p("u7", "Print-on-Demand Microfluidics for Wearables", ["Lea Kim"], "A printable channel design for sweat sensors.", "Technical evaluation", undefined, "other"),
    ],
    createdAt: at,
    updatedAt: at,
  }
}

export const seedThreads = (): Record<string, ThreadRead> => Object.fromEntries([readingTools(), toolUse(), nothingFound(), venue()].map((c) => [c.id, c]))
