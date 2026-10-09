import { Link } from "react-router-dom"
import { BookOpenIcon, FileTextIcon } from "lucide-react"
import { shortCite } from "@/features/docs/lib/mentions"
import { useDocsStore } from "@/features/docs/store"
import { displayName, isMarkdown } from "@/features/docs/types"
import { useChatStore } from "@/features/chat/store"
import { useLibraryStore } from "@/features/library/store"
import { openSettings, useSettings } from "@/features/settings/store"
import { ago } from "../lib/when"
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
  const status = useStatus()

  const marks = new Map<string, number>()
  for (const h of Object.values(highlights)) marks.set(h.paperId, (marks.get(h.paperId) ?? 0) + 1)
  const touchedPapers = Object.values(papers)
    .filter((p) => marks.has(p.id) || notes[p.id]?.content.trim())
    .sort((a, b) => (marks.get(b.id) ?? 0) - (marks.get(a.id) ?? 0))
    .map((p) => {
      const n = marks.get(p.id) ?? 0
      const what = [n && `${n} highlight${n === 1 ? "" : "s"}`, notes[p.id]?.content.trim() && "a note"].filter(Boolean).join(", ")
      return { key: p.id, to: `/library/${p.id}`, icon: BookOpenIcon, title: shortCite(p), what }
    })
  const docs = Object.values(files)
    .filter((f) => isMarkdown(f.path))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .map((f) => ({ key: f.id, to: `/docs/${f.id}`, icon: FileTextIcon, title: displayName(f.path), what: "your doc" }))
  const material = [...touchedPapers, ...docs]

  if (!material.length) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-[15px] font-medium">No topics yet</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Owlit keeps its understanding of your research here, as topics. A topic starts once two things you read, highlighted, wrote or said are about the same question.
        </p>
        {status ?? <p className="mt-4 text-[13px] text-muted-foreground">There’s nothing to do here; it fills in by itself.</p>}
      </div>
    )
  }
  const more = material.length - SHOWN
  return (
    <div className="mx-auto max-w-md py-16">
      <p className="text-center text-[15px] font-medium">No topics yet</p>
      <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
        Topics start from what you’ve touched. None has started from these yet; one will once two of them are about the same question.
      </p>
      <div className="mt-4 flex flex-col gap-0.5">
        {material.slice(0, SHOWN).map((m) => (
          <Link key={m.key} to={m.to} className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none hover:bg-muted focus-key:bg-muted">
            <m.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[60%] shrink-0 truncate">{m.title}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.what}</span>
          </Link>
        ))}
        {more > 0 && <p className="px-2.5 pt-1 text-[13px] text-muted-foreground">and {more} more</p>}
      </div>
      <div className="text-center">{status}</div>
    </div>
  )
}

// Only what is true now: the agent that can't read the material, or when Owlit last did
function useStatus() {
  const run = useKnowledgeStore((s) => s.lastRun)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const agent = useChatStore((s) => s.connectors.find((c) => c.id === background))
  if (agent && (agent.status === "not_installed" || agent.status === "error")) {
    return (
      <p className="mt-4 text-[13px] text-muted-foreground">
        Owlit can’t read your material while {agent.name} {agent.status === "not_installed" ? "isn’t installed" : "can’t run"}.{" "}
        <button type="button" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => openSettings("agents")}>
          Manage agents…
        </button>
      </p>
    )
  }
  return run ? <p className="mt-4 text-[13px] text-muted-foreground">Owlit last read your workspace {ago(run.at)}.</p> : null
}
