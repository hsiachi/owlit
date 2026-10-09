import type { PaperKnowledge, TopicSidecar } from "@owlit/protocol"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { useKnowledgeStore } from "./store"

// In the desktop app what the user did to Knowledge lives in the workspace (.owlit/knowledge/), where core
// reads it to keep runs from undoing it: the store loads it when a workspace opens, writes each topic's
// sidecar and each paper's passages back as they change, and takes what core changed (an agent's write, a
// run) from knowledge.changed and knowledge.updated.

let applying = false

function apply(fn: () => void) {
  applying = true
  try {
    fn()
  } finally {
    applying = false
  }
}

const put = (what: "topic" | "paper", id: string, value: TopicSidecar | PaperKnowledge) => {
  const call = what === "topic" ? rpc.knowledge.putTopic({ id, sidecar: value as TopicSidecar }) : rpc.knowledge.putPaper({ id, paper: value as PaperKnowledge })
  call.catch((error) => console.warn(`[owlit] Knowledge ${what} ${id} not saved`, error))
}

if (isDesktop) {
  onWorkspaceOpened(async () => {
    apply(() => useKnowledgeStore.setState({ topics: {}, papers: {}, loose: [], lastRun: null }))
    const state = await rpc.knowledge.state().catch(() => null)
    if (state) apply(() => useKnowledgeStore.setState({ topics: state.topics, papers: state.papers, lastRun: state.lastRun }))
  })

  useKnowledgeStore.subscribe((s, prev) => {
    if (applying) return
    for (const [id, side] of Object.entries(s.topics)) if (prev.topics[id] !== side) put("topic", id, side)
    for (const [id, paper] of Object.entries(s.papers)) if (prev.papers[id] !== paper) put("paper", id, paper)
  })

  onNotify("knowledge.changed", ({ topics, papers }) =>
    apply(() => useKnowledgeStore.setState((s) => ({ topics: { ...s.topics, ...topics }, papers: { ...s.papers, ...papers } }))),
  )
  onNotify("knowledge.updated", (run) => {
    if (run.items.length) apply(() => useKnowledgeStore.setState({ lastRun: run }))
  })
}
