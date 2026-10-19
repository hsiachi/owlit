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
import { ago, clock, isToday, shortDate } from "@/lib/time"
import { isDesktop, rpc } from "@/lib/rpc"
import { useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { useNewOwlitComments } from "@/features/docs/owlit"
import { openRun } from "@/features/runs/hooks"
import { useRunsStore } from "@/features/runs/store"
import { KIND_ICON } from "@/lib/kinds"
import { useChatStore } from "@/features/chat/store"
import { listChanges, useSeen, useThreadFresh } from "@/app/seen"
import { nameOf, useMe } from "@/lib/actors"
import { plural, t } from "@lingui/core/macro"
import { useExtensionWaits } from "@/features/extension/store"
import { cameLine } from "@/features/extension/waits"
import { sinceLines, type SinceLine } from "./since-lines"

// After three days or more away, counted from when the user left (core's presence): one row per chat whose
// work finished meanwhile and that the user hasn't opened since (the jobs they handed off before leaving),
// then what others changed meanwhile as the change log has it, one line per place, naming the things
// (since-lines.ts). After any time away, however short, the runs Owlit finished meanwhile come first (a
// digest, a Go through), one row each, which open what the run worked on, and a line for
// the PDFs that came through the user's browser meanwhile. A run on a thread says so in the thread's own
// line, so it has none of its own.

interface Finished {
  id: string
  title: string
  at: number
}

// Runs that show in their subject's own row here (threads)
const QUIET_RUNS = (kind: string) => kind.startsWith("threads.")

// all: the user was away three days or more, and everything is said; else only Owlit's runs
export function SinceYouLeft({ since, all }: { since: number; all: boolean }) {
  const navigate = useNavigate()
  const papers = useLibraryStore((s) => s.papers)
  const runs = useRunsSince(since)
  const lines = useSinceLines(since, all)

  // PDFs the extension in the user's browser brought meanwhile, said after any time away as Owlit's runs
  // are: owlit fetched them on its own
  const siteWaits = useExtensionWaits()
  const came = useMemo(() => Object.values(papers).filter((p) => p.pdf?.came?.by === "extension" && p.pdf.came.at > since).length, [papers, since])
  const pdfs = cameLine(came, siteWaits)
  // The chat list's own mark, "Finished since you last looked", limited to replies that ended while away;
  // opening the chat takes it off, here as in the list. Only those chats are selected, and a finished
  // chat isn't streaming, so a streamed reply elsewhere redraws nothing here.
  const unseenChats = useSeen(useShallow((s) => s.unseen.chats))
  const finishedChats = useChatStore(useShallow((s) => unseenChats.flatMap((id) => s.chats[id] ?? [])))
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

  const finished = all ? finishedAll : []
  if (!runs.length && !pdfs && !lines.length && !finished.length) return null

  // Today's leaving by the clock, an earlier one by the day
  const left = isToday(since) ? clock(since) : shortDate(since)
  return (
    <section className="mt-8">
      <GroupLabel>{isToday(since) ? t`Since you left at ${left}` : t`Since you left on ${left}`}</GroupLabel>
      <div className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
        {pdfs && <ListRow onClick={() => navigate("/library")} mark={<KindIcon kind="paper" className="size-4" />} title={pdfs.title} detail={pdfs.detail} />}
        {finished.map((f) => {
          const when = ago(f.at, { inSentence: true })
          return <ListRow key={f.id} to={`/chat/${f.id}`} icon={KIND_ICON.chat} title={f.title} end={t`Finished ${when}`} />
        })}
        {lines.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </div>
    </section>
  )
}

// What others changed since then, from the log, asked again whenever something new came; nothing short
// of three days away
function useSinceLines(since: number, all: boolean) {
  const me = useMe()
  const unseen = useSeen((s) => s.unseen)
  const [lines, setLines] = useState<SinceLine[]>([])
  useEffect(() => {
    if (!all || !me) return
    let live = true
    listChanges({ since }).then(
      (changes) => live && setLines(sinceLines(changes, me)),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [since, all, me, unseen])
  return all ? lines : []
}

// A few names, then how many more
function names(list: string[]) {
  const shownNames = list.slice(0, 3).join(", ")
  const more = list.length - 3
  return more > 0 ? plural(more, { one: `${shownNames} and # more`, other: `${shownNames} and # more` }) : shownNames
}

function Line({ line }: { line: SinceLine }) {
  if (line.kind === "thread") return <ThreadLine line={line} />
  if (line.kind === "papers") return <PapersLine line={line} />
  return <DocLine line={line} />
}

function ThreadLine({ line }: { line: Extract<SinceLine, { kind: "thread" }> }) {
  const thread = useThreadsStore((s) => s.threads[line.id])
  const fresh = useThreadFresh(line.id)
  if (!thread) return null
  const view = shown(thread)
  const title = view.title
  const what = line.made
    ? t`New thread: ${title}`
    : line.added.length
      ? plural(line.added.length, { one: `# paper added to ${title}`, other: `# papers added to ${title}` })
      : t`${title} changed`
  const detail = line.made ? plural(view.rows.length, { one: "# paper", other: "# papers" }) : line.added.length ? names(line.added) : undefined
  return <ListRow to={`/threads/${line.id}`} mark={<NoteDot gone={!fresh} />} title={what} detail={detail} />
}

function PapersLine({ line }: { line: Extract<SinceLine, { kind: "papers" }> }) {
  const navigate = useNavigate()
  const titles = useLibraryStore(useShallow((s) => line.ids.flatMap((id) => s.papers[id]?.title ?? [])))
  if (!titles.length) return null
  return (
    <ListRow
      onClick={() => navigate("/library")}
      mark={<KindIcon kind="paper" className="size-4" />}
      title={plural(titles.length, { one: "# paper added to your Library", other: "# papers added to your Library" })}
      detail={names(titles)}
    />
  )
}

// A doc changed, or new comments on it: it opens, with Owlit's dot while those comments are unseen
function DocLine({ line }: { line: Extract<SinceLine, { kind: "doc" | "comments" }> }) {
  const file = useDocsStore((s) => Object.values(s.files).find((f) => f.path === line.path))
  const fresh = useNewOwlitComments(file).length > 0
  const name = displayName(line.path)
  const who = nameOf(line.actor)
  const outside = line.actor === "other"
  let what: string
  if (line.kind === "comments") what = plural(line.count, { one: `${who} left # comment on ${name}`, other: `${who} left # comments on ${name}` })
  else if (line.did === "made") what = outside ? t`${name} was made outside owlit` : t`${who} wrote ${name}`
  else if (line.did === "removed") what = outside ? t`${name} was removed outside owlit` : t`${who} removed ${name}`
  else what = outside ? t`${name} was changed outside owlit` : t`${who} edited ${name}`
  const mark = line.kind === "comments" && fresh ? <NoteDot /> : <KindIcon kind="doc" className="size-4" />
  const when = ago(line.at)
  return file && !(line.kind === "doc" && line.did === "removed") ? <ListRow to={`/docs/${file.id}`} mark={mark} title={what} end={when} /> : <ListRow mark={mark} title={what} end={when} />
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
// digest opens its paper; any other run opens itself
function RunRow({ run }: { run: RunSummary }) {
  const navigate = useNavigate()
  const { kind, subject } = run.run
  const docPath = kind.startsWith("docs.") ? subject.split("#")[0]! : null
  const file = useDocsStore((s) => (docPath ? Object.values(s.files).find((f) => f.path === docPath) : undefined))
  const fresh = useNewOwlitComments(file).length > 0
  const when = ago(run.endedAt, { inSentence: true })
  const open = () => {
    if (file) navigate(`/docs/${file.id}`)
    else if (kind === "paper.digest") navigate(`/library/${subject}`)
    else void openRun(run.id)
  }
  const mark = fresh ? <NoteDot /> : <KindIcon kind={kind === "paper.digest" ? "paper" : "doc"} className="size-4" />
  return <ListRow onClick={open} mark={mark} title={run.title} end={when} />
}
