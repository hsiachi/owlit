import { plural, t } from "@lingui/core/macro"
import { itemId, parseOwlitUri, type ThreadRead } from "@owlit/protocol"
import { ThreadTable } from "../components/ThreadTable"
import { useEffect, useLayoutEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ActionsDropdownContent, MenuButton } from "@/components/action-menu"
import { NoteDot } from "@/components/marks"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { Button } from "@/components/ui/button"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { useTakeParam } from "@/hooks/use-take-param"
import { readDepthSummary } from "@/components/read-depth"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { stopChat, tryAgain } from "@/features/chat/started"
import { About } from "../components/About"
import { AnswerRows } from "../components/AnswerRows"
import { projectAt, useProjects } from "@/features/projects/store"
import { useThreadMenu } from "../components/ThreadMenu"
import { isTable, paperCounts, shown as shownOf } from "../lib"
import { useThread, useThreadsStore } from "../store"
import { SEEN_AFTER_MS, useVisitDots } from "../seen"
import { markSeen } from "@/app/seen"
import { useThreadsUi } from "../ui-store"
import { useThreadWork, workWords } from "../work"

// Where each thread's page was scrolled to, for this session: Back from a paper a row opened lands on
// the row again
const lastScroll = new Map<string, number>()

// One visit per thread: going from one to another (Undo, a link) starts at the top with that thread's own
// idea of what changed since the user looked
export function ThreadPage() {
  const { threadId } = useParams()
  return <ThreadVisit key={threadId} threadId={threadId} />
}

// A thread is Owlit's to write and the user's to read: the title, Owlit's report, then the papers it rests
// on, and where it came from. Nothing on it is edited in place; the user asks in a chat.
function ThreadVisit({ threadId }: { threadId: string | undefined }) {
  const navigate = useNavigate()
  const thread = useThread(threadId)
  const loaded = useThreadsStore((s) => s.loaded)
  const projects = useProjects()
  const groups = useThreadMenu(thread, projects, { afterDelete: () => navigate("/threads") })
  const set = useThreadsUi((s) => s.set)
  // What changed since the user last looked carries the dot until they leave
  const visit = useVisitDots(threadId)
  const id = thread?.id
  const page = useRef<HTMLDivElement>(null)
  // Back where it was left, after the first layout; a link to one of its papers scrolls to that row instead
  const hasPage = !!thread
  useEffect(() => {
    const el = page.current
    if (!threadId || !el) return
    const top = lastScroll.get(threadId)
    if (top !== undefined && !new URLSearchParams(window.location.search).has("paper")) requestAnimationFrame(() => el.scrollTo({ top }))
    const keep = () => lastScroll.set(threadId, el.scrollTop)
    el.addEventListener("scroll", keep, { passive: true })
    return () => el.removeEventListener("scroll", keep)
  }, [threadId, hasPage])
  // A row left open from before closes. A layout effect, so it comes before the link's paper is taken below
  // (layout effects run in order, and before plain ones).
  useLayoutEffect(() => {
    if (id) set({ peek: null, ring: null })
  }, [id, set])
  // Opened for one of its papers (a link to a paper from elsewhere, "In" on a paper's page): that paper's
  // row opens, where it is in the list. After the reset above, so it stays open.
  useTakeParam(
    "paper",
    (want) => {
      set({ peek: want })
      requestAnimationFrame(() => document.getElementById(`row-${want}`)?.scrollIntoView({ block: "center" }))
    },
    { enabled: !!id },
  )
  // A moment on the page is a look at the thread as a whole, and at its title and report at the top; its rows
  // are seen one by one as they come on screen (useSeenOnScreen)
  useEffect(() => {
    if (!id) return
    const timer = setTimeout(() => {
      const c = useThreadsStore.getState().threads[id]
      if (c) markSeen({ kind: "thread", id, items: [itemId.title(), itemId.report()] })
    }, SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [id])

  if (!thread) {
    if (!loaded) return null
    return <NotFound title={t`This thread is gone`} detail={t`It may have been deleted.`} back={{ label: t`Back to Threads`, to: "/threads" }} />
  }
  const shown = shownOf(thread)
  const table = isTable(shown)
  // The breadcrumb names the project while its folder is marked; a thread whose mark went has none
  const project = projectAt(projects, thread.project)
  // A paper the report names that is a row of the thread: the table opens its row; the note rings it where
  // it is (AnswerRows). Others go where they live.
  const onLink = (uri: string) => {
    const u = parseOwlitUri(uri)
    if (u?.kind !== "paper" || !shown.rows.some((r) => r.id === u.id)) return false
    if (table) {
      set({ peek: u.id })
      requestAnimationFrame(() => document.getElementById(`row-${u.id}`)?.scrollIntoView({ block: "center" }))
    } else set({ ring: { id: u.id, at: Date.now() } })
    return true
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: t`Threads`, to: "/threads" }, ...(project ? [{ label: project.name, to: `/threads?project=${encodeURIComponent(project.path)}` }] : [])]} current={shown.title}>
        <DropdownMenu>
          <MenuButton label={t`Thread actions`} />
          <ActionsDropdownContent groups={groups} align="end" className="w-56" />
        </DropdownMenu>
      </PageHeader>
      <div ref={page} className="min-h-0 flex-1 overflow-y-auto">
        {/* One frame whatever the form: the words stay in the reading column, so the title never moves when
            a column is asked, and only a table reaches into the Library's wide column below them */}
        <article className="pt-8 pb-32">
          <div className="mx-auto w-full max-w-3xl px-4">
            <PageTitle className="text-balance">{shown.title}</PageTitle>
            <WorkLine thread={thread} />
            <Report thread={thread} fresh={visit.fresh(itemId.report())} onLink={onLink} />
            <PaperCounts shown={shown} />
            {!table && <AnswerRows thread={thread} shown={shown} visit={visit} />}
          </div>
          {table && (
            <div className="mx-auto w-full max-w-6xl px-6">
              <ThreadTable thread={thread} shown={shown} visit={visit} />
            </div>
          )}
          <div className="mx-auto w-full max-w-3xl px-4">
            <About thread={thread} />
          </div>
        </article>
      </div>
    </div>
  )
}

// Owlit's report, drawn as a doc is: its papers are mentions, and one that is a row of the thread goes to
// that row (onLink). The line under it says whose it is and how it changes, with Owlit's dot while it is
// new since the user looked.
function Report({ thread, fresh, onLink }: { thread: ThreadRead; fresh: boolean; onLink: (uri: string) => boolean }) {
  if (!thread.report.trim()) return null
  return (
    <section className="mt-4 max-w-[68ch]">
      <Markdown text={thread.report} className="text-body" onLink={onLink} />
      <p className="mt-3 flex items-center gap-2 text-detail text-muted-foreground">
        {fresh && <NoteDot />}
        {t({ message: "Owlit's report. To change it, ask in a chat.", comment: "under the report at the top of a thread" })}
      </p>
    </section>
  )
}

// "Papers · 10 papers, 5 groups · 5 full text, 5 abstract only": the papers below, the groups they are
// in, how far Owlit read them, in the words the rows and a chat's answer use (components/read-depth.ts)
function PaperCounts({ shown }: { shown: ThreadRead }) {
  const { papers, groups, depths } = paperCounts(shown)
  if (!papers) return null
  const n = plural(papers, { one: "# paper", other: "# papers" })
  const g = plural(groups, { one: "# group", other: "# groups" })
  const read = readDepthSummary(depths)
  return (
    <p className="mt-8 border-t pt-4 text-detail text-muted-foreground">
      {groups
        ? t({ message: `Papers · ${n}, ${g} · ${read}`, comment: "the line over a thread's papers: how many, in how many groups, how far Owlit read them" })
        : t({ message: `Papers · ${n} · ${read}`, comment: "the line over a thread's papers: how many, how far Owlit read them" })}
    </p>
  )
}

// What Owlit is doing on the thread, one muted line under the title while it works (its words shimmer)
// with Stop, or why it stopped with Retry. Nothing when it isn't working. Several chats can work on the
// thread at once: the line says the earliest, and how many more.
function WorkLine({ thread }: { thread: ThreadRead }) {
  const { running, failed } = useThreadWork(thread.id)
  const chat = running[0]
  if (chat) {
    const more = running.length - 1
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="shimmer">{workWords()}</span>
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
