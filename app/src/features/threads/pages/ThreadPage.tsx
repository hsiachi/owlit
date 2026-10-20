import { t } from "@lingui/core/macro"
import { itemId, QUESTION_COLUMN } from "@owlit/protocol"
import { ThreadTable } from "../components/ThreadTable"
import { useEffect, useLayoutEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ActionsDropdownContent, MenuButton } from "@/components/action-menu"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { useTakeParam } from "@/hooks/use-take-param"
import { About } from "../components/About"
import { AnswerRows } from "../components/AnswerRows"
import { WorkLine } from "../components/Work"
import { useThreadMenu } from "../components/ThreadMenu"
import { Memo } from "../components/Memo"
import { shown as shownOf } from "../lib"
import { useThread, useThreadsStore } from "../store"
import { SEEN_AFTER_MS, useVisitDots } from "../seen"
import { markSeen } from "@/app/seen"
import { useThreadsUi } from "../ui-store"
import { scrollMotion } from "@/lib/utils"

// Where each thread's page was scrolled to, for this session: Back from a paper a cell opened lands on
// the cell again
const lastScroll = new Map<string, number>()

// One visit per thread: going from one to another (a group made its own, Undo, a link) starts at the
// top with that thread's own idea of what changed since the user looked
export function ThreadPage() {
  const { threadId } = useParams()
  return <ThreadVisit key={threadId} threadId={threadId} />
}

function ThreadVisit({ threadId }: { threadId: string | undefined }) {
  const navigate = useNavigate()
  const thread = useThread(threadId)
  const loaded = useThreadsStore((s) => s.loaded)
  const groups = useThreadMenu(thread, { afterDelete: () => navigate("/threads") })
  const set = useThreadsUi((s) => s.set)
  // What changed since the user last looked carries the dot until they leave
  const visit = useVisitDots(threadId)
  const fresh = visit.fresh
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
    if (id) set({ peek: null })
  }, [id, set])
  // Opened for one of its papers (a link to a paper the Library hasn't got, "In" on a paper's page): that
  // paper's row opens, where it is in the list. After the reset above, so it stays open.
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
  // A question asked of every paper, or Owlit's groups, make it a table; a hidden grouping without groups
  // doesn't
  const table = shown.columns.some((c) => c.id !== QUESTION_COLUMN && (!c.hidden || (c.kind === "grouping" && !!c.groups?.length)))
  // A paper the report names opens as its row, where it is in the list
  const openRow = (paperId: string) => {
    if (!shown.rows.some((r) => r.id === paperId)) return false
    set({ peek: paperId })
    requestAnimationFrame(() => document.getElementById(`row-${paperId}`)?.scrollIntoView({ block: "nearest", behavior: scrollMotion() }))
    return true
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: t`Threads`, to: "/threads" }, ...(thread.project ? [{ label: thread.project, to: `/threads?project=${encodeURIComponent(thread.project)}` }] : [])]} current={shown.title}>
        <DropdownMenu>
          <MenuButton label={t`Thread actions`} />
          <ActionsDropdownContent groups={groups} align="end" className="w-56" />
        </DropdownMenu>
      </PageHeader>
      <div ref={page} className="min-h-0 flex-1 overflow-y-auto">
        {/* One frame whatever the form: the words stay in the reading column, so the title never moves when
            a column is added, and only a table reaches into the Library's wide column below them */}
        <article className="pt-8 pb-32">
          <div className="mx-auto w-full max-w-3xl px-4">
            <PageTitle className="text-balance">{shown.title}</PageTitle>
            <WorkLine thread={thread} />
            <Memo thread={thread} fresh={fresh} onRow={openRow} />
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
