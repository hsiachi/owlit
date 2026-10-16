import { useEffect, useMemo, useState } from "react"
import type { RunSummary } from "@owlit/protocol"
import { useNavigate } from "react-router-dom"
import { useShallow } from "zustand/react/shallow"
import { GroupLabel } from "@/components/group-label"
import { KindIcon } from "@/components/kind-icon"
import { ListRow } from "@/components/list-row"
import { NoteDot } from "@/components/marks"
import { useLibraryStore } from "@/features/library/store"
import { shown } from "@/features/threads/lib"
import { useThreadsStore } from "@/features/threads/store"
import { ago, clock, DAY, isToday, shortDate } from "@/lib/time"
import { isDesktop, rpc } from "@/lib/rpc"
import { useDocsStore } from "@/features/docs/store"
import { newOwlitComments, useOwlitSeenAt } from "@/features/docs/owlit"
import { openRun } from "@/features/runs/hooks"
import { useRunsStore } from "@/features/runs/store"
import { KIND_ICON } from "@/lib/kinds"
import { useChatStore } from "@/features/chat/store"
import { useSeenStore } from "@/features/chat/status"
import { plural, t } from "@lingui/core/macro"

// After three days or more away: one row per chat whose work finished meanwhile and that the user hasn't
// opened since (the jobs they handed off before leaving), one row per thread Owlit started or added
// to meanwhile, and one line for papers Owlit added to the Library. It belongs to this launch only; what
// the user doesn't open keeps its dot in Threads. After any time away, however short, the runs Owlit
// finished meanwhile come first (its night shift: a doc it read after the user's edits, its daily look,
// a digest), one row each, which open what the run worked on. A run on a thread says so in the thread's
// own row, so it has none of its own.

export const AWAY_FOR = 3 * DAY

interface Changed {
  id: string
  title: string
  what: string
  // Owlit changed it since the user last looked at it
  unseen: boolean
}

interface Finished {
  id: string
  title: string
  at: number
}

// Runs that show in their subject's own row here (threads), or say nothing worth a row
const QUIET_RUNS = (kind: string) => kind.startsWith("threads.") || kind === "paper.relate"

// all: the user was away three days or more, and everything is said; else only Owlit's runs
export function SinceYouLeft({ since, all }: { since: number; all: boolean }) {
  const navigate = useNavigate()
  const threads = useThreadsStore((s) => s.threads)
  const papers = useLibraryStore((s) => s.papers)
  const runs = useRunsSince(since)

  const changedAll = useMemo<Changed[]>(
    () =>
      Object.values(threads)
        .filter((c) => c.updatedAt > since && (c.createdAt > since || Object.values(c.changedAt).some((at) => at > since)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => {
          const view = shown(c)
          const added = view.rows.filter((r) => r.addedAt > since).length
          const what =
            c.createdAt > since
              ? plural(view.rows.length, { one: "New thread · # paper", other: "New thread · # papers" })
              : added
                ? plural(added, { one: "# new paper", other: "# new papers" })
                : t({ message: "Changed", comment: "a thread Owlit changed without adding papers" })
          return { id: c.id, title: view.title, what, unseen: c.seenAt === 0 || Object.values(c.changedAt).some((at) => at > c.seenAt) }
        }),
    [threads, since],
  )
  const addedAll = useMemo(() => Object.values(papers).filter((p) => p.addedBy === "agent" && p.addedAt > since).length, [papers, since])
  // The chat list's own mark, "Finished since you last looked", limited to replies that ended while away;
  // opening the chat takes it off, here as in the list. Only those chats are selected, and a finished
  // chat isn't streaming, so a streamed reply elsewhere redraws nothing here.
  const unseenChats = useSeenStore((s) => s.unseen)
  const finishedChats = useChatStore(useShallow((s) => Object.values(s.chats).filter((c) => unseenChats[c.id] === "finished")))
  const finishedAll = useMemo<Finished[]>(
    () =>
      finishedChats
        .flatMap((c) => {
          const last = c.messages.at(-1)
          const at = last?.role === "assistant" ? last.finishedAt : undefined
          return at && at > since ? [{ id: c.id, title: c.title, at }] : []
        })
        .sort((a, b) => b.at - a.at),
    [finishedChats, since],
  )

  const changed = all ? changedAll : []
  const added = all ? addedAll : 0
  const finished = all ? finishedAll : []
  if (!runs.length && !changed.length && !added && !finished.length) return null

  // Today's leaving by the clock, an earlier one by the day
  const left = isToday(since) ? clock(since) : shortDate(since)
  return (
    <section className="mt-8">
      <GroupLabel>{isToday(since) ? t`Since you left at ${left}` : t`Since you left on ${left}`}</GroupLabel>
      <div className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
        {finished.map((f) => {
          const when = ago(f.at, { inSentence: true })
          return <ListRow key={f.id} to={`/chat/${f.id}`} icon={KIND_ICON.chat} title={f.title} end={t`Finished ${when}`} />
        })}
        {changed.map((c) => (
          <ListRow key={c.id} to={`/threads/${c.id}`} mark={<NoteDot gone={!c.unseen} />} title={c.title} detail={c.what} />
        ))}
        {added > 0 && (
          <ListRow
            onClick={() => navigate("/library")}
            mark={<KindIcon kind="paper" className="size-4" />}
            title={plural(added, { one: "Owlit added # paper to your Library", other: "Owlit added # papers to your Library" })}
          />
        )}
      </div>
    </section>
  )
}

// Owlit's runs that ended well since then, read from core, and again whenever a run starts or ends
function useRunsSince(since: number) {
  const heard = useRunsStore((s) => s.runs)
  const [runs, setRuns] = useState<RunSummary[]>([])
  useEffect(() => {
    if (!isDesktop) return
    let live = true
    rpc.chats.runs({ since }).then(
      (got) => live && setRuns(got.filter((r) => r.ended === "done" && !QUIET_RUNS(r.run.kind))),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [since, heard])
  return runs
}

// A run on a doc opens the doc, with Owlit's dot while it left comments there the user hasn't seen; a
// digest opens its paper; a look over every doc opens the run itself
function RunRow({ run }: { run: RunSummary }) {
  const navigate = useNavigate()
  const { kind, subject } = run.run
  const docPath = kind.startsWith("docs.") && kind !== "docs.scan" ? subject.split("#")[0]! : null
  const file = useDocsStore((s) => (docPath ? Object.values(s.files).find((f) => f.path === docPath) : undefined))
  const seenAt = useOwlitSeenAt(docPath ?? "")
  const fresh = useDocsStore((s) => (file ? newOwlitComments(s.comments[file.id], seenAt).length > 0 : false))
  const when = ago(run.endedAt, { inSentence: true })
  const open = () => {
    if (file) navigate(`/docs/${file.id}`)
    else if (kind === "paper.digest") navigate(`/library/${subject}`)
    else void openRun(run.id)
  }
  const mark = fresh ? <NoteDot /> : <KindIcon kind={kind === "paper.digest" ? "paper" : "doc"} className="size-4" />
  return <ListRow onClick={open} mark={mark} title={run.title} end={when} />
}
