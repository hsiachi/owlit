import type { SourceKind } from "../types"

// The Chat page is where work is handed off (a quick question goes through the agent window, ⌘J), so the
// starters are jobs that take a few minutes. Each fills a prompt stem; where it needs a paper or doc, the
// mention popup opens on that kind.
export const starters: { label: string; prompt: string; kind?: SourceKind | "all" }[] = [
  { label: "Find papers and add them", prompt: "Find recent papers on " },
  { label: "Compare papers", prompt: "Compare the methods and findings of ", kind: "paper" },
  { label: "Review a draft", prompt: "Review where I overstate a finding or misread a paper in ", kind: "doc" },
  { label: "Ask about your papers", prompt: "What do my papers say about " },
]
