import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { QUESTION_COLUMN, shownCollection, type Collection } from "@owlit/protocol"
import { CollectionTable } from "../components/CollectionTable"
import { EllipsisVerticalIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ActionsDropdownContent } from "@/components/action-menu"
import { GroupLabel } from "@/components/group-label"
import { MentionLink } from "@/components/mention/mention-token"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { chatUri } from "@owlit/protocol"
import { mentionRoute } from "@/features/docs/lib/mentions"
import { useChatStore } from "@/features/chat/store"
import { isDesktop } from "@/lib/rpc"
import { shortDate } from "@/lib/time"
import { joinAnd } from "@/lib/words"
import { AnswerRows } from "../components/AnswerRows"
import { CollectionActions, WorkLine } from "../components/Work"
import { useCollectionMenu } from "../components/CollectionMenu"
import { Memo } from "../components/Memo"
import { editCollection, useCollection, useCollectionsStore } from "../store"
import { useCollectionsUi } from "../ui-store"

// After this long on the page, what Owlit changed counts as seen; its dots stay for this visit
const SEEN_AFTER_MS = 1500

// One visit per collection: going from one to another (a group made its own, Undo, a link) starts at the
// top with that collection's own idea of what changed since the user looked
export function CollectionPage() {
  const { collectionId } = useParams()
  return <CollectionVisit key={collectionId} collectionId={collectionId} />
}

function CollectionVisit({ collectionId }: { collectionId: string | undefined }) {
  const navigate = useNavigate()
  const collection = useCollection(collectionId)
  const loaded = useCollectionsStore((s) => s.loaded)
  const groups = useCollectionMenu(collection, { afterDelete: () => navigate("/collections") })
  const renaming = useCollectionsUi((s) => s.renaming === collectionId)
  const set = useCollectionsUi((s) => s.set)
  // When the user last looked before this visit: what changed since carries the dot until they leave
  const [seenBefore, setSeenBefore] = useState<number | null>(null)
  const id = collection?.id
  // Opened for one of its papers (a link to a paper the Library hasn't got, "In" on a paper's page): that
  // paper's row opens, where it is in the list
  const [params, setParams] = useSearchParams()
  const want = params.get("paper")
  useEffect(() => {
    if (!id) return
    setSeenBefore(useCollectionsStore.getState().collections[id]?.seenAt ?? 0)
    set({ peek: null })
    const timer = setTimeout(() => void editCollection(id, { op: "seen" }), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [id, set])
  // After the reset above, so a page opened for a paper keeps it open
  useEffect(() => {
    if (!id || !want) return
    set({ peek: want })
    setParams((p) => (p.delete("paper"), p), { replace: true })
    requestAnimationFrame(() => document.getElementById(`row-${want}`)?.scrollIntoView({ block: "center" }))
  }, [id, want, set, setParams])

  if (!collection) {
    if (!loaded) return null
    return <NotFound title={t`This collection is gone`} detail={t`It may have been deleted.`} back={{ label: t`Back to Collections`, to: "/collections" }} />
  }
  const shown = shownCollection(collection)
  const since = seenBefore ?? collection.seenAt
  // A question asked of every paper, or Owlit's groups, make it a table
  const table = shown.columns.some((c) => c.id !== QUESTION_COLUMN && !c.hidden) || shown.groups.length > 0
  // A paper the memo names opens as its row, where it is in the list
  const openRow = (paperId: string) => {
    if (!shown.rows.some((r) => r.id === paperId)) return false
    set({ peek: paperId })
    requestAnimationFrame(() => document.getElementById(`row-${paperId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    return true
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: t`Collections`, to: "/collections" }, ...(collection.project ? [{ label: collection.project, to: `/collections?project=${encodeURIComponent(collection.project)}` }] : [])]} current={shown.title}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t`Collection actions`} className="text-muted-foreground data-[state=open]:bg-muted">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
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
                label={t`Collection name`}
                onDone={(name) => {
                  if (name !== null) void editCollection(collection.id, { op: "rename", title: name })
                  set({ renaming: null })
                }}
                className="-mx-2 h-9 px-2 text-title font-medium"
              />
            ) : (
              <PageTitle className="text-balance">{shown.title}</PageTitle>
            )}
            <WorkLine collection={collection} />
            <Memo collection={collection} shown={shown} seenBefore={since} onRow={openRow} />
            {/* What can be asked of the papers, in one place for both forms, before them, so a long list
                doesn't bury it */}
            <CollectionActions collection={collection} />
            {!table && <AnswerRows collection={collection} shown={shown} seenBefore={since} />}
          </div>
          {table && (
            <div className="mx-auto w-full max-w-6xl px-6">
              <CollectionTable collection={collection} shown={shown} seenBefore={since} />
            </div>
          )}
          <div className="mx-auto w-full max-w-3xl px-4">
            <About collection={collection} table={table} />
          </div>
        </article>
      </div>
    </div>
  )
}

// Where the collection came from and how far Owlit looked: kept, but at the end, so the page opens on the
// reading itself. Only what is true of this page: no "list above" without papers, "table" for a table.
function About({ collection: c, table }: { collection: Collection; table: boolean }) {
  // A collection made from another keeps the question it was really asked; a group made a collection of its
  // own was asked nothing, so it says where it came from instead of quoting the group's name back
  const question = c.splitFrom?.asked ?? c.asked
  const fromGroup = !!c.splitFrom && !c.splitFrom.asked
  const origin = useCollectionsStore((s) => (c.splitFrom ? s.collections[c.splitFrom.id] : undefined))
  const chat = useChatStore((s) => (question.chatId ? s.chats[question.chatId] : undefined))
  const rows = shownCollection(c).rows
  const read = rows.filter((r) => Object.values(r.cells).some((cell) => cell.depth === "full")).length
  const where = c.sources.length ? joinAnd(c.sources) : undefined
  const papers = rows.length
  const looked = where
    ? papers
      ? t`Owlit looked in ${where} and read ${read} of the ${papers} papers in full; the rest are from their abstracts.`
      : t`Owlit looked in ${where}.`
    : papers
      ? t`Owlit read ${read} of the ${papers} papers in full; the rest are from their abstracts.`
      : undefined
  const legend = papers
    ? table
      ? t`The table above is Owlit's reading of them. A page number points to the words an answer rests on; an answer without one comes from the abstract.`
      : t`The list above is Owlit's reading of them. A page number points to the words an answer rests on; an answer without one comes from the abstract.`
    : undefined
  const asked = question.text
  const when = shortDate(question.at)
  const from = question.chatId && (chat || !isDesktop) ? chatUri(question.chatId) : undefined
  const chatTitle = chat?.title || t`a chat`
  const originLink = origin ? <MentionLink label={shownCollection(origin).title} to={`/collections/${origin.id}`} /> : t`another collection`
  return (
    <section className="mt-12 max-w-[68ch] text-detail leading-relaxed text-muted-foreground">
      <GroupLabel className="px-0">{t`About this collection`}</GroupLabel>
      {fromGroup ? (
        <p>
          <Trans comment="a collection the user made from one of another collection's groups">
            Made from the group <span className="text-foreground/80">“{asked}”</span> in {originLink}, {when}.
          </Trans>
        </p>
      ) : (
        <p>
          {from ? (
            <Trans>
              You asked <span className="text-foreground/80">“{asked}”</span> in <MentionLink label={chatTitle} to={mentionRoute(from)} />, {when}.
            </Trans>
          ) : (
            <Trans>
              You asked <span className="text-foreground/80">“{asked}”</span>, {when}.
            </Trans>
          )}
          {c.splitFrom && (
            <>
              {" "}
              <Trans comment="after the question: its papers were first added to another collection, then kept apart">Kept separate from {originLink}.</Trans>
            </>
          )}
        </p>
      )}
      {(c.alsoAsked ?? []).map((a, i) => {
        const later = a.text
        const on = shortDate(a.at)
        return (
          <p key={i}>
            <Trans comment="a later question Owlit answered by adding to this collection">
              Then <span className="text-foreground/80">“{later}”</span>, {on}.
            </Trans>
          </p>
        )
      })}
      {looked && (
        <p className="mt-0.5">
          {looked} {legend}
        </p>
      )}
      {c.watch && <p className="mt-0.5">{t`Owlit watches for new papers on this question.`}</p>}
    </section>
  )
}
