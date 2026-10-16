import { t } from "@lingui/core/macro"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { KIND_ICON } from "@/lib/kinds"
import { useOpenFromChat } from "@/features/agent/hooks"
import type { ResultRow } from "@/features/chat/components/messages/ResultRows"
import { owlitToolOf } from "@/features/chat/lib/tool-title"
import type { MessagePart } from "@owlit/protocol"
import { useTasksStore } from "@/features/tasks/store"
import { digestFailed, digestUnderWay, retryDigest } from "./digests"
import { useLibraryStore } from "./store"

// The papers an answer asked Owlit to write a digest of, by the tool's own reply ("Owlit is writing a
// digest for <id>; …"); one that already had a digest asked for nothing
function askedFor(parts: MessagePart[]) {
  const ids: string[] = []
  for (const p of parts) {
    if (p.type !== "tool_call" || p.status !== "completed" || owlitToolOf(p.tool?.name ?? p.title) !== "library_request_digest") continue
    const id = /^Owlit is writing a digest for (\S+?);/.exec(p.content ?? "")?.[1]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

type Stand = "writing" | "ready" | "failed" | "asked"

// The rows an answer that asked for digests adds to its result card: the paper, and how its digest stands,
// followed live. A digest asked for in chat is told here, where it was asked, rather than in a toast: the
// agent may have asked on its own, and the user is told what the reply did by its card.
export function useDigestRows(parts: MessagePart[]): ResultRow[] {
  const navigate = useOpenFromChat()
  const ids = askedFor(parts)
  // One string, so the card redraws when a digest moves on rather than on every task or paper change
  const stands = useTasksStore((s) => ids.map((id) => (digestUnderWay(s.byId, id) ? "writing" : digestFailed(s.byId, id) ? "failed" : "")).join(",")).split(",")
  const papers = useLibraryStore(useShallow((s) => ids.map((id) => s.papers[id])))
  return ids.flatMap((id, i) => {
    const paper = papers[i]
    if (!paper) return []
    const stand: Stand = stands[i] === "writing" ? "writing" : stands[i] === "failed" ? "failed" : paper.hasDigest ? "ready" : "asked"
    const retry = () => void retryDigest(paper)
    return [
      {
        key: `digest:${id}`,
        kind: "digest" as const,
        icon: KIND_ICON.paper,
        name: paper.title,
        detail:
          stand === "writing" ? (
            <span className="shimmer">{t`Writing the digest…`}</span>
          ) : stand === "failed" ? (
            <>
              {t`Digest stopped`}
              {/* Above the row's own click, as Undo is */}
              <Button variant="text" size="inline" onClick={retry} className="relative">
                {t`Retry`}
              </Button>
            </>
          ) : stand === "ready" ? (
            t`Digest ready`
          ) : (
            t`Asked for a digest`
          ),
        undone: false,
        view: () => navigate(`/library/${id}`),
      },
    ]
  })
}
