import type { ResolvedPaper } from "../types"

// References the mock resolver knows; paste any of these ids into Add to get full metadata
export const knownRefs: ResolvedPaper[] = [
  {
    title: "Tree of Thoughts: Deliberate Problem Solving with Large Language Models",
    authors: ["Shunyu Yao", "Dian Yu", "Jeffrey Zhao", "Izhak Shafran", "Thomas L. Griffiths", "Yuan Cao", "Karthik Narasimhan"],
    year: 2023,
    venue: "NeurIPS",
    abstract:
      "Extends chain-of-thought prompting into a search over intermediate thoughts, letting a model explore, evaluate and backtrack over alternative reasoning paths.",
    ids: { arxiv: "2305.10601" },
    pdf: { url: "https://arxiv.org/pdf/2305.10601" },
  },
  {
    title: "Reflexion: Language Agents with Verbal Reinforcement Learning",
    authors: ["Noah Shinn", "Federico Cassano", "Edward Berman", "Ashwin Gopinath", "Karthik Narasimhan", "Shunyu Yao"],
    year: 2023,
    venue: "NeurIPS",
    abstract:
      "Agents improve across trials by writing verbal reflections on their failures into an episodic memory, instead of updating weights.",
    ids: { arxiv: "2303.11366" },
    pdf: { url: "https://arxiv.org/pdf/2303.11366" },
  },
  {
    title: "Sensecape: Enabling Multilevel Exploration and Sensemaking with Large Language Models",
    authors: ["Sangho Suh", "Bryan Min", "Srishti Palani", "Haijun Xia"],
    year: 2023,
    venue: "UIST",
    abstract:
      "A canvas-based interface that lets people organise LLM responses spatially and at several levels of abstraction while exploring a topic.",
    ids: { doi: "10.1145/3586183.3606756", arxiv: "2305.11483" },
    pdf: { url: "https://arxiv.org/pdf/2305.11483" },
  },
]
