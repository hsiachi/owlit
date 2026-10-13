import { EmptyPlace } from "@/components/empty-place"
import { ListRow } from "@/components/list-row"
import { KIND_ICON } from "@/lib/kinds"
import { citationLabel } from "@/features/library/lib/format"
import { useDocsStore } from "@/features/docs/store"
import { displayName, isMarkdown } from "@/features/docs/types"
import { problemSentence } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { useLibraryStore } from "@/features/library/store"
import { openSettings, useSettings } from "@/features/settings/store"
import { ago } from "@/lib/time"
import { touchedWords } from "../format"
import { useKnowledgeStore } from "../store"

const SHOWN = 5

// Knowledge before its first topic. It says why it is empty, since nothing else would: a topic starts
// only once two things the user touched are about the same question. When they have touched things, it
// lists them, so "nothing yet" comes with what topics can start from.
export function KnowledgeEmpty() {
  const papers = useLibraryStore((s) => s.papers)
  const highlights = useLibraryStore((s) => s.highlights)
  const notes = useLibraryStore((s) => s.notes)
  const files = useDocsStore((s) => s.files)
  const status = useKnowledgeStatus()

  const marks = new Map<string, number>()
  for (const h of Object.values(highlights)) marks.set(h.paperId, (marks.get(h.paperId) ?? 0) + 1)
  const touchedPapers = Object.values(papers)
    .filter((p) => marks.has(p.id) || notes[p.id]?.content.trim())
    .sort((a, b) => (marks.get(b.id) ?? 0) - (marks.get(a.id) ?? 0))
    .map((p) => ({ key: p.id, to: `/library/${p.id}`, icon: KIND_ICON.paper, title: citationLabel(p), what: touchedWords(marks.get(p.id) ?? 0, !!notes[p.id]?.content.trim()) }))
  const docs = Object.values(files)
    .filter((f) => isMarkdown(f.path))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .map((f) => ({ key: f.id, to: `/docs/${f.id}`, icon: KIND_ICON.doc, title: displayName(f.path), what: "your doc" }))
  const material = [...touchedPapers, ...docs]

  if (!material.length)
    return (
      <EmptyPlace
        title="No topics yet"
        detail="Owlit keeps its understanding of your research here, as topics. A topic starts once two things you read, highlighted, wrote or said are about the same question."
        note={status ?? "There’s nothing to do here; it fills in by itself."}
        className="mx-auto max-w-md py-16"
      />
    )
  const more = material.length - SHOWN
  return (
    <EmptyPlace
      title="No topics yet"
      detail="Topics start from what you’ve touched. None has started from these yet; one will once two of them are about the same question."
      note={status}
      className="mx-auto max-w-md py-16"
    >
      <div className="flex w-full flex-col gap-0.5 text-left">
        {material.slice(0, SHOWN).map((m) => (
          <ListRow key={m.key} to={m.to} size="sm" icon={m.icon} title={m.title} detail={m.what} />
        ))}
        {more > 0 && <p className="px-2.5 pt-1 text-detail text-muted-foreground">and {more} more</p>}
      </div>
    </EmptyPlace>
  )
}

// Only what is true now: the agent that can't read the material, or when Owlit last did. The Knowledge
// page's empty state and a paper's Knowledge tab end on the same line.
export function useKnowledgeStatus() {
  const run = useKnowledgeStore((s) => s.lastRun)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const agent = useChatStore((s) => s.connectors.find((c) => c.id === background))
  const problem = agent && problemSentence(agent)
  if (problem) {
    return (
      <>
        Owlit can’t read your material while {problem}.{" "}
        <button type="button" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => openSettings("agents")}>
          Manage agents…
        </button>
      </>
    )
  }
  return run ? <>Owlit last read your workspace {ago(run.at, { inSentence: true })}.</> : null
}
