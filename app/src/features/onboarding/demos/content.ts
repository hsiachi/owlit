// What the demos show inside the small window: papers, a page of a PDF, a draft, a chat, a topic. It is
// example material, the same in every language (a library's papers are in theirs), so it is plain English
// here rather than messages; the window's own chrome around it is said through Lingui where it shows.

export interface DemoPaper {
  title: string
  // authors · year, as the Library's rows say it
  meta: string
}

export const LIBRARY_PAPERS: DemoPaper[] = [
  { title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", meta: "Lewis et al. · 2020" },
  { title: "RAGTruth: A Hallucination Corpus for Developing Trustworthy RAG", meta: "Niu et al. · 2024" },
  { title: "FActScore: Fine-grained Atomic Evaluation of Factual Precision", meta: "Min et al. · 2023" },
  { title: "Lost in the Middle: How Language Models Use Long Contexts", meta: "Liu et al. · 2023" },
]

// Read: a PDF dropped into the Library, opened, highlighted, then its digest
export const READ = {
  file: "self-rag.pdf",
  title: "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection",
  short: "Self-RAG",
  // The details panel's title, cut as the panel cuts it
  sideTitle: "Self-RAG: Learning to Retrieve, Generate, and Critique…",
  meta: "Asai et al. · 2023",
  authors: "Akari Asai, Zeqiu Wu, Yizhong Wang, Avirup Sil, Hannaneh Hajishirzi",
  section: "1 Introduction",
  before:
    "Large language models often produce responses that are factually inaccurate despite their increased model and data scale. Retrieval-Augmented Generation methods augment the input with relevant passages, reducing factual errors in knowledge-intensive tasks. However, these methods may hinder the versatility of the model or introduce unnecessary or off-topic passages. ",
  highlighted: "We introduce a new framework that enhances quality and factuality through retrieval on demand and self-reflection.",
  after:
    " Our framework trains a single arbitrary LM that adaptively retrieves passages on-demand, and generates and reflects on retrieved passages and its own generations using special tokens, called reflection tokens.",
  // The highlight as the Highlights tab quotes it
  quote: "“We introduce a new framework that enhances quality and factuality…”",
  position: 3,
  total: 12,
  digest: {
    question: "The question",
    questionText: "Retrieval helps factual answers, but fetching passages for every prompt adds noise. Can a model decide when to retrieve, and check that its answer is supported?",
    how: "How it works",
    // The sentence in runs, the token names in bold
    howRuns: [
      { text: "One model emits reflection tokens: " },
      { text: "Retrieve", bold: true },
      { text: " decides whether to fetch passages; " },
      { text: "IsRel", bold: true },
      { text: ", " },
      { text: "IsSup", bold: true },
      { text: " and " },
      { text: "IsUse", bold: true },
      { text: " grade each passage and its own output " },
    ],
    howPage: "p. 4",
    figure: ["Retrieve?", "Passages", "Critique"],
    figureCaption: "Figure 1 · p. 2",
    found: "What they found",
    foundText: "Better factuality and citation accuracy than ChatGPT on long-form answers ",
    foundPage: "p. 7",
  },
}

// Write: a sentence typed, a paper cited with @, a sentence rewritten by Owlit
export const WRITE = {
  crumb: "Drafts › Related work",
  title: "Related work",
  lead: "Retrieval-augmented generation grounds a model's answers in documents ",
  leadCite: "(Lewis et al. 2020)",
  typed: "But models still say things their sources don't back up ",
  mention: "@rag",
  cite: "(Niu et al. 2024)",
  rewritten: "Yet even with retrieval, models still make claims their sources do not support ",
  choices: [
    { title: "RAGTruth", meta: "Niu et al. 2024" },
    { title: "Self-RAG", meta: "Asai et al. 2023" },
    { title: "Retrieval-Augmented Generation", meta: "Lewis et al. 2020" },
  ],
}

// Ask: ⌘J over a paper, then work handed off in Chat
export const ASK = {
  section: "3 Self-RAG",
  body: "Self-RAG trains an LM to generate text with reflection tokens. Given an input, the model first decides whether retrieval would help by predicting a Retrieve token. If so, it calls a retriever and processes several passages in parallel, then predicts IsRel, IsSup and IsUse tokens to judge each passage and its own output.",
  section2: "3.1 Problem formalization",
  body2:
    "Formally, given input x, we train M to sequentially generate textual outputs y consisting of multiple segments, where tokens include those from the original vocabulary as well as the reflection tokens.",
  paper: "Self-RAG",
  meta: "Asai et al. · 2023",
  question: "How does it decide when to retrieve?",
  pages: "3–5",
  answer:
    "It predicts a Retrieve token before each segment. When the token says yes, it fetches passages and grades each with IsRel and IsSup, keeping the best-supported answer",
  answerPage: "p. 4",
  // The agent the composer shows: a name, the same in every language
  agent: "Claude Code",
  handOff: "Find 2024 papers on hallucination benchmarks for RAG and add the good ones",
  found: 37,
  added: [
    { title: "RAGTruth: A Hallucination Corpus for Trustworthy RAG", meta: "Niu et al." },
    { title: "FaithEval: Can Your Model Stay Faithful to Context?", meta: "Ming et al." },
    { title: "The FACTS Grounding Leaderboard", meta: "Jacovi et al." },
    { title: "Summary of a Haystack", meta: "Laban et al." },
  ],
}

// Collect: a question becomes papers with what each says; one of Owlit's answers gets corrected
export const COLLECT = {
  question: "When should a model retrieve?",
  title: "Deciding when to retrieve",
  rows: [
    { text: "A learned Retrieve token decides per segment, and passages are graded after.", cite: "Asai et al. 2023", page: 4 },
    { text: "Retrieving before every answer helps knowledge-heavy tasks most.", cite: "Lewis et al. 2020", page: 0 },
    { text: "Retrieving when confidence drops beats retrieving every time on long answers.", cite: "Jiang et al. 2023", page: 6 },
  ],
  memo: ["Most methods decide per step whether to retrieve.", "None compares a learned decision with a fixed rule on the same tasks."],
  corrected: "Retrieving every time helps most on open-domain QA.",
}
