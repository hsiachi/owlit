import type { Mentionable } from "../types"

// Placeholder items standing in for the Library, Docs and Knowledge stores
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

export const knowledge: Mentionable[] = [
  { id: "k1", kind: "knowledge", title: "Scaling compute improves sample efficiency", subtitle: "Claim", uri: "owlit://knowledge/k1" },
  { id: "k2", kind: "knowledge", title: "Does RLHF reduce calibration?", subtitle: "Question", uri: "owlit://knowledge/k2" },
  { id: "k3", kind: "knowledge", title: "Tool use in LLMs", subtitle: "Cluster", uri: "owlit://knowledge/k3" },
  { id: "k4", kind: "knowledge", title: "In-context learning emerges with scale", subtitle: "Claim", uri: "owlit://knowledge/k4" },
  { id: "k5", kind: "knowledge", title: "Retrieval vs. parametric memory", subtitle: "Cluster", uri: "owlit://knowledge/k5" },
]

export const allMentionables: Mentionable[] = [...papers, ...docs, ...knowledge]

export function searchMentionables(query: string): Mentionable[] {
  const q = query.trim().toLowerCase()
  if (!q) return allMentionables
  return allMentionables.filter(
    (m) => m.title.toLowerCase().includes(q) || m.subtitle?.toLowerCase().includes(q),
  )
}
