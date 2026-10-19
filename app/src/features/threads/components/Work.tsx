import { t } from "@lingui/core/macro"
import type { Thread } from "@owlit/protocol"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"
import { CompareDialog } from "./CompareDialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cancelTask, resumeTask } from "@/features/tasks/store"
import { openRun } from "@/features/runs/hooks"
import { shown as shownOf } from "../lib"
import { askEach, runWords, startRun, useThreadWork } from "../runs"

// What Owlit is doing on the thread, one muted line under the title while it works (its words
// shimmer) with Stop, or why it stopped with Retry. Nothing when it isn't working.
export function WorkLine({ thread }: { thread: Thread }) {
  const { running, broken } = useThreadWork(thread.id)
  const task = running[0]
  if (task) {
    const papers = shownOf(thread).rows.length
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        {/* The line opens the run itself: its steps so far, in the Owlit panel */}
        {task.chatId ? (
          <button type="button" className="shimmer hover:underline" onClick={() => void openRun(task.chatId!)}>
            {runWords(task, thread)}
          </button>
        ) : (
          <span className="shimmer">{runWords(task, thread)}</span>
        )}
        {task.kind === "threads.gather" && papers > 0 && <span>{t`${papers} so far`}</span>}
        <Button variant="text" size="inline" onClick={() => void cancelTask(task.id)}>
          {t({ message: "Stop", comment: "stop Owlit's work on a thread" })}
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

// What the user can ask of the thread, as plain text buttons under the memo, the same for a list and a
// table. Each one runs in the background; while it runs, its button rests. With no papers there is nothing
// to ask of each or to draft from: only searching further, here or with a wider question in a chat.
export function ThreadActions({ thread }: { thread: Thread }) {
  const navigate = useNavigate()
  const { running } = useThreadWork(thread.id)
  const busy = (kind: string) => running.some((task) => task.kind === kind)
  const shown = shownOf(thread)
  const abstractOnly = shown.rows.some((r) => Object.values(r.cells).every((cell) => cell.depth !== "full"))
  const title = shown.title
  const asked = thread.asked.text
  const draft = () =>
    navigate("/chat", { state: { starter: t`Draft a review from the thread “${title}”. Propose an outline first, and wait for me before writing.` } })
  const widen = () =>
    navigate("/chat", { state: { starter: t`Nothing came up for “${asked}”. Help me widen the question: suggest broader or neighbouring questions to search.` } })
  const empty = !shown.rows.length
  // While the first gather runs, an empty thread is only not filled yet
  if (empty && busy("threads.gather")) return null
  return (
    <div className="mt-4 -ml-1.5 flex flex-wrap items-center gap-1">
      <Button variant="text" size="inline" disabled={busy("threads.more") || busy("threads.gather")} title={t`Searches further and adds papers to this thread`} onClick={() => void startRun(thread.id, "more")}>
        {t`Find more papers`}
      </Button>
      {empty ? (
        <Button variant="text" size="inline" title={t`Owlit suggests broader or neighbouring questions in a chat`} onClick={widen}>
          {t`Widen the question…`}
        </Button>
      ) : (
        <>
          <AskEach thread={thread} />
          {abstractOnly && (
            <Button variant="text" size="inline" disabled={busy("threads.read")} title={t`Reads in full the papers answered from their abstracts, where there's a PDF; they join your Library`} onClick={() => void startRun(thread.id, "read")}>
              {t`Read all in full`}
            </Button>
          )}
          <Button variant="text" size="inline" title={t`Owlit proposes an outline in a chat first`} onClick={draft}>
            {t`Draft a review…`}
          </Button>
        </>
      )}
    </div>
  )
}

// Ask each paper…: a question for every paper, typed or picked, which becomes a column; or Compare with a
// doc…, sentences of the user's that every paper is set against. From the text button under the memo, or
// the + at the end of a table's header.
export function AskEach({ thread, trigger = "text" }: { thread: Thread; trigger?: "text" | "plus" }) {
  const [comparing, setComparing] = useState(false)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const common = [t`Method and sample`, t`Main finding`, t`Limitations`, t`What they built`]
  const ask = (q: string) => {
    if (!q.trim()) return
    setOpen(false)
    setQuestion("")
    void askEach(thread.id, q)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger === "plus" ? (
        <Tip label={t`Ask each paper…`}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t`Ask each paper…`} className="-mx-1 text-muted-foreground data-[state=open]:bg-accent">
              <PlusIcon />
            </Button>
          </PopoverTrigger>
        </Tip>
      ) : (
        <PopoverTrigger asChild>
          <Button variant="text" size="inline" className="data-[state=open]:bg-muted data-[state=open]:text-foreground">
            {t`Ask each paper…`}
          </Button>
        </PopoverTrigger>
      )}
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
        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => (setOpen(false), setComparing(true))}
          className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent focus-key:bg-accent"
        >
          {t`Compare with a doc…`}
        </button>
        <p className="px-2.5 pt-1.5 pb-1 text-detail text-muted-foreground">{t`Each question becomes a column; Owlit answers it from the abstracts.`}</p>
      </PopoverContent>
      <CompareDialog threadId={thread.id} open={comparing} onOpenChange={setComparing} />
    </Popover>
  )
}
