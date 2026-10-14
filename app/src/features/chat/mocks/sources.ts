import type { Mentionable } from "../types"

// Placeholder items for the seeded chats; the composer's @ list reads the real Library, Docs and Collections
export const papers: Mentionable[] = [
  { id: "p1", kind: "paper", title: "Attention Is All You Need", subtitle: "Vaswani et al. · 2017", uri: "owlit://library/p1" },
  { id: "p2", kind: "paper", title: "Language Models are Few-Shot Learners", subtitle: "Brown et al. · 2020", uri: "owlit://library/p2" },
  { id: "p3", kind: "paper", title: "Training language models to follow instructions with human feedback", subtitle: "Ouyang et al. · 2022", uri: "owlit://library/p3" },
  { id: "p4", kind: "paper", title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", subtitle: "Lewis et al. · 2020", uri: "owlit://library/p4" },
  { id: "p5", kind: "paper", title: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models", subtitle: "Wei et al. · 2022", uri: "owlit://library/p5" },
  { id: "p6", kind: "paper", title: "Toolformer: Language Models Can Teach Themselves to Use Tools", subtitle: "Schick et al. · 2023", uri: "owlit://library/p6" },
  { id: "p7", kind: "paper", title: "ReAct: Synergizing Reasoning and Acting in Language Models", subtitle: "Yao et al. · 2022", uri: "owlit://library/p7" },
  { id: "p8", kind: "paper", title: "Scaling Laws for Neural Language Models", subtitle: "Kaplan et al. · 2020", uri: "owlit://library/p8" },
]

export const docs: Mentionable[] = [
  { id: "d1", kind: "doc", title: "literature-review.md", subtitle: "notes/", uri: "owlit://docs/notes/literature-review.md" },
  { id: "d2", kind: "doc", title: "proposal-draft.md", subtitle: "writing/", uri: "owlit://docs/writing/proposal-draft.md" },
  { id: "d3", kind: "doc", title: "reading-log.md", subtitle: "notes/", uri: "owlit://docs/notes/reading-log.md" },
  { id: "d4", kind: "doc", title: "meeting-2026-10-02.md", subtitle: "meetings/", uri: "owlit://docs/meetings/meeting-2026-10-02.md" },
  { id: "d5", kind: "doc", title: "experiment-plan.md", subtitle: "experiments/", uri: "owlit://docs/experiments/experiment-plan.md" },
]
