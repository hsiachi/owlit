import { paperUri } from "@owlit/protocol"
import type { Line, Ref } from "../types"

// The scripted steps the mock update run applies, by topic: the lines Owlit would add or rewrite

export interface ScriptStep {
  id: string
  why: string
  // The line to add or, with `replaces`, the line it rewrites
  line: Omit<Line, "id">
  replaces?: string
  source?: { ref: Ref; how: string }
}

export const SCRIPT: Record<string, ScriptStep[]> = {
  "when-to-call": [
    {
      id: "react-both",
      why: "you read Yao 2022",
      line: { speaker: "Yao 2022", text: "ReAct did best when combined with chain of thought, drawing on what the model knows and on what it looks up.", sources: [{ label: "§1", uri: paperUri("p7", "react-both") }], condition: "Prompted with one to six examples, not trained." },
    },
  ],
  retrieval: [
    {
      id: "rag-tool",
      why: "you read Schick 2023 §2",
      line: { speaker: "Schick 2023", text: "Toolformer treats a retrieval system as one more API, sampled and filtered like the calculator.", sources: [{ label: "§2", uri: paperUri("p6", "tf-retrieval") }] },
    },
  ],
}
