import { t } from "@lingui/core/macro"
import { QUESTION_COLUMN } from "@owlit/protocol"
import { ThreadTable } from "../components/ThreadTable"
import { useEffect, useLayoutEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ActionsDropdownContent, MenuButton } from "@/components/action-menu"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { useTakeParam } from "@/hooks/use-take-param"
import { About } from "../components/About"
import { AnswerRows } from "../components/AnswerRows"
import { ThreadActions, WorkLine } from "../components/Work"
import { useThreadMenu, useProjects } from "../components/ThreadMenu"
import { Memo } from "../components/Memo"
import { shown as shownOf } from "../lib"
import { editThread, useThread, useThreadsStore } from "../store"
import { useThreadsUi } from "../ui-store"
import { scrollMotion } from "@/lib/utils"

// After this long on the page, what Owlit changed counts as seen; its dots stay for this visit
const SEEN_AFTER_MS = 1500

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
  const groups = useThreadMenu(thread, useProjects(), { afterDelete: () => navigate("/threads") })
  const renaming = useThreadsUi((s) => s.renaming === threadId)
  const set = useThreadsUi((s) => s.set)
  // When the user last looked before this visit: what changed since carries the dot until they leave
  const [seenBefore, setSeenBefore] = useState<number | null>(null)
  const id = thread?.id
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
  useEffect(() => {
    if (!id) return
    setSeenBefore(useThreadsStore.getState().threads[id]?.seenAt ?? 0)
    const timer = setTimeout(() => void editThread(id, { op: "seen" }), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [id])

  if (!thread) {
    if (!loaded) return null
    return <NotFound title={t`This thread is gone`} detail={t`It may have been deleted.`} back={{ label: t`Back to Threads`, to: "/threads" }} />
  }
  const shown = shownOf(thread)
  const since = seenBefore ?? thread.seenAt
  // A question asked of every paper, or Owlit's groups, make it a table
  const table = shown.columns.some((c) => c.id !== QUESTION_COLUMN && !c.hidden) || shown.groups.length > 0
  // A paper the memo names opens as its row, where it is in the list
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* One frame whatever the form: the words stay in the reading column, so the title never moves when
            a column is added, and only a table reaches into the Library's wide column below them */}
        <article className="pt-8 pb-32">
          <div className="mx-auto w-full max-w-3xl px-4">
            {renaming ? (
              <RenameInput
                initial={shown.title}
                label={t`Thread name`}
                onDone={(name) => {
                  if (name !== null) void editThread(thread.id, { op: "rename", title: name })
                  set({ renaming: null })
                }}
                className="-mx-2 h-9 px-2 text-title font-medium"
              />
            ) : (
              <PageTitle className="text-balance">{shown.title}</PageTitle>
            )}
            <WorkLine thread={thread} />
            <Memo thread={thread} shown={shown} seenBefore={since} onRow={openRow} />
            {/* What can be asked of the papers, in one place for both forms, before them, so a long list
                doesn't bury it */}
            <ThreadActions thread={thread} />
            {!table && <AnswerRows thread={thread} shown={shown} seenBefore={since} />}
          </div>
          {table && (
            <div className="mx-auto w-full max-w-6xl px-6">
              <ThreadTable thread={thread} shown={shown} seenBefore={since} />
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
