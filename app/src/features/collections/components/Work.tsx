import { t } from "@lingui/core/macro"
import { shownCollection, type Collection } from "@owlit/protocol"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cancelTask, resumeTask } from "@/features/tasks/store"
import { askEach, runWords, startRun, useCollectionWork } from "../runs"

// What Owlit is doing on the collection, one muted line under the title while it works (its words
// shimmer) with Stop, or why it stopped with Retry. Nothing when it isn't working.
export function WorkLine({ collection }: { collection: Collection }) {
  const { running, broken } = useCollectionWork(collection.id)
  const task = running[0]
  if (task) {
    const papers = shownCollection(collection).rows.length
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="shimmer">{runWords(task, collection)}</span>
        {task.kind === "collections.gather" && papers > 0 && <span>{t`${papers} so far`}</span>}
        <Button variant="text" size="inline" onClick={() => void cancelTask(task.id)}>
          {t({ message: "Stop", comment: "stop Owlit's work on a collection" })}
        </Button>
      </p>
    )
  }
  if (broken) {
    const why = broken.error ?? ""
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="text-destructive">{t`Owlit stopped.`}</span>
        <span className="min-w-0 truncate" title={why}>
          {why}
        </span>
        <Button variant="text" size="inline" onClick={() => void resumeTask(broken.id)}>
          {t`Retry`}
        </Button>
      </p>
    )
  }
  return null
}

// What the user can ask of the collection, as plain text buttons after its papers. Each one runs in the
// background; while it runs, its button rests.
export function CollectionActions({ collection }: { collection: Collection }) {
  const navigate = useNavigate()
  const { running } = useCollectionWork(collection.id)
  const busy = (kind: string) => running.some((task) => task.kind === kind)
  const shown = shownCollection(collection)
  const abstractOnly = shown.rows.some((r) => Object.values(r.cells).every((cell) => cell.depth === "abstract"))
  const title = shown.title
  const draft = () =>
    navigate("/chat", { state: { starter: t`Draft a review from the collection “${title}”. Propose an outline first, and wait for me before writing.` } })
  return (
    <div className="mt-4 -ml-1.5 flex flex-wrap items-center gap-1">
      <Button variant="text" size="inline" disabled={busy("collections.more") || busy("collections.gather")} title={t`Searches further and adds papers to this collection`} onClick={() => void startRun(collection.id, "more")}>
        {t`Find more papers`}
      </Button>
      <AskEach collection={collection} />
      {abstractOnly && (
        <Button variant="text" size="inline" disabled={busy("collections.read")} title={t`Reads in full the papers answered from their abstracts, where there's a PDF; they join your Library`} onClick={() => void startRun(collection.id, "read")}>
          {t`Read all in full`}
        </Button>
      )}
      <Button variant="text" size="inline" title={t`Owlit proposes an outline in a chat first`} onClick={draft}>
        {t`Draft a review…`}
      </Button>
    </div>
  )
}

// Ask each paper…: a question for every paper, typed or picked, which becomes a column
function AskEach({ collection }: { collection: Collection }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const common = [t`Method and sample`, t`Main finding`, t`Limitations`, t`What they built`]
  const ask = (q: string) => {
    if (!q.trim()) return
    setOpen(false)
    setQuestion("")
    void askEach(collection.id, q)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="text" size="inline" className="data-[state=open]:bg-muted data-[state=open]:text-foreground">
          {t`Ask each paper…`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1.5">
        <input
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          placeholder={t`Ask each paper…`}
          aria-label={t`A question for every paper`}
          className="mb-1 h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-foreground/30"
        />
        {common.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent focus-key:bg-accent">
            {q}
          </button>
        ))}
        <p className="px-2.5 pt-1.5 pb-1 text-detail text-muted-foreground">{t`Each question becomes a column; Owlit answers it from the abstracts.`}</p>
      </PopoverContent>
    </Popover>
  )
}
