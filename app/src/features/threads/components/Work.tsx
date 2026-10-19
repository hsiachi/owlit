import { plural, t } from "@lingui/core/macro"
import type { Thread } from "@owlit/protocol"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"
import { CompareDialog } from "./CompareDialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { stopChat, tryAgain } from "@/features/chat/started"
import { useLibraryStore } from "@/features/library/store"
import { libraryPaperOf, shown as shownOf } from "../lib"
import { askEach, startWork, useThreadWork, workWords } from "../work"

// What a paper read in full costs in the agent's time, roughly: one turn that adds it, reads the parts
// that matter and rewrites its answers. Said on the button's hover so the work's size is known before it
// starts; it is a guess, not a measurement.
const MINUTES_PER_PAPER = 0.8

// What Owlit is doing on the thread, one muted line under the title while it works (its words
// shimmer) with Stop, or why it stopped with Retry. Nothing when it isn't working. Several chats can work
// on the thread at once: the line says the earliest, and how many more.
export function WorkLine({ thread }: { thread: Thread }) {
  const { running, failed } = useThreadWork(thread.id)
  const chat = running[0]
  if (chat) {
    const papers = shownOf(thread).rows.length
    const more = running.length - 1
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="shimmer">{workWords(chat, thread)}</span>
        {chat.about.recipe === "gather" && papers > 0 && <span>{t`${papers} so far`}</span>}
        {more > 0 && <span>{plural(more, { one: "and # more", other: "and # more" })}</span>}
        <Button variant="text" size="inline" onClick={() => stopChat(chat)}>
          {t({ message: "Stop", comment: "stop Owlit's work on a thread" })}
        </Button>
      </p>
    )
  }
  if (failed) {
    const why = failed.reply.error ?? ""
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="text-destructive">{t`Owlit stopped.`}</span>
        <span className="min-w-0 truncate" title={why}>
          {why}
        </span>
        <Button variant="text" size="inline" onClick={() => void tryAgain(failed.chatId)}>
          {t`Retry`}
        </Button>
      </p>
    )
  }
  return null
}

// What the user can ask of the thread, as plain text buttons under the memo, the same for a list and a
// table. Each one starts a chat about the thread; while it works, its button rests. With no papers there is nothing
// to ask of each or to draft from: only searching further, here or with a wider question in a chat. The
// two that run at once say their size first: Read N in full counts the papers it will read (and on hover
// how long, and how many have no PDF and are left out), Find more papers asks what to look for.
export function ThreadActions({ thread }: { thread: Thread }) {
  const navigate = useNavigate()
  const { running } = useThreadWork(thread.id)
  const busy = (recipe: string) => running.some((chat) => chat.about.recipe === recipe)
  const shown = shownOf(thread)
  // The rows Read in full would read, as core counts them (threads.ts toRead): answered from the
  // abstract or title, with a free PDF known or the paper's text in the Library already
  const papers = useLibraryStore((s) => s.papers)
  const aliases = useLibraryStore((s) => s.aliases)
  const fromAbstract = shown.rows.filter((r) => Object.values(r.cells).every((cell) => cell.depth !== "full"))
  const toRead = fromAbstract.filter((r) => r.paper.openPdf || !!libraryPaperOf(r, papers, aliases)?.pdf).length
  const noPdf = fromAbstract.length - toRead
  const minutes = Math.max(1, Math.round(toRead * MINUTES_PER_PAPER))
  const readTip = [
    plural(minutes, { one: "About # minute with your agent", other: "About # minutes with your agent" }),
    noPdf > 0 && plural(noPdf, { one: "# has no PDF and is left out", other: "# have no PDF and are left out" }),
  ]
    .filter(Boolean)
    .join(" · ")
  const title = shown.title
  const asked = thread.asked.text
  const draft = () =>
    navigate("/chat", { state: { starter: t`Draft a review from the thread “${title}”. Propose an outline first, and wait for me before writing.` } })
  const widen = () =>
    navigate("/chat", { state: { starter: t`Nothing came up for “${asked}”. Help me widen the question: suggest broader or neighbouring questions to search.` } })
  const empty = !shown.rows.length
  // While the first gather runs, an empty thread is only not filled yet
  if (empty && busy("gather")) return null
  return (
    <div className="mt-4 -ml-1.5 flex flex-wrap items-center gap-1">
      <FindMore thread={thread} disabled={busy("find-more") || busy("gather")} />
      {empty ? (
        <Button variant="text" size="inline" title={t`Owlit suggests broader or neighbouring questions in a chat`} onClick={widen}>
          {t`Widen the question…`}
        </Button>
      ) : (
        <>
          <AskEach thread={thread} />
          {fromAbstract.length > 0 && (
            <Button variant="text" size="inline" disabled={busy("read-in-full") || toRead === 0} title={toRead ? readTip : t`None of the papers answered from their abstracts has a PDF to read`} onClick={() => void startWork(thread.id, "read")}>
              {plural(toRead, { one: "Read # in full", other: "Read # in full" })}
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

// Find more papers…: what to look for this time, prefilled with the thread's question, since a search
// further usually has a narrower target than the question as it stands
function FindMore({ thread, disabled }: { thread: Thread; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState("")
  const find = () => {
    if (!what.trim()) return
    setOpen(false)
    void startWork(thread.id, "more", what.trim())
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setWhat(thread.asked.text)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="text" size="inline" disabled={disabled} title={t`Searches further and adds papers to this thread`} className="data-[state=open]:bg-muted data-[state=open]:text-foreground">
          {t`Find more papers…`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-1.5">
        <label className="px-2.5 pt-1 pb-1.5 text-detail text-muted-foreground" htmlFor={`find-more-${thread.id}`}>
          {t`What to look for`}
        </label>
        <input
          id={`find-more-${thread.id}`}
          autoFocus
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && find()}
          onFocus={(e) => e.target.select()}
          className="mb-1 h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-foreground/30"
        />
        <div className="flex items-center justify-end gap-1 px-0.5 pt-1 pb-0.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t`Cancel`}
          </Button>
          <Button size="sm" disabled={!what.trim()} onClick={find}>
            {t({ message: "Find", comment: "button: start finding more papers for a thread" })}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
