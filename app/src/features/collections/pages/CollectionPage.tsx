import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { shownCollection, type Collection } from "@owlit/protocol"
import { EllipsisVerticalIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
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
import { useCollectionMenu } from "../components/CollectionMenu"
import { Memo } from "../components/Memo"
import { editCollection, useCollection, useCollectionsStore } from "../store"
import { useCollectionsUi } from "../ui-store"

// After this long on the page, what Owlit changed counts as seen; its dots stay for this visit
const SEEN_AFTER_MS = 1500

export function CollectionPage() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const collection = useCollection(collectionId)
  const loaded = useCollectionsStore((s) => s.loaded)
  const groups = useCollectionMenu(collection, { afterDelete: () => navigate("/collections") })
  const renaming = useCollectionsUi((s) => s.renaming === collectionId)
  const set = useCollectionsUi((s) => s.set)
  // When the user last looked before this visit: what changed since carries the dot until they leave
  const [seenBefore, setSeenBefore] = useState<number | null>(null)
  const id = collection?.id
  useEffect(() => {
    if (!id) return
    setSeenBefore(useCollectionsStore.getState().collections[id]?.seenAt ?? 0)
    set({ peek: null })
    const timer = setTimeout(() => void editCollection(id, { op: "seen" }), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [id, set])

  if (!collection) {
    if (!loaded) return null
    return <NotFound title={t`This collection is gone`} detail={t`It may have been deleted.`} back={{ label: t`Back to Collections`, to: "/collections" }} />
  }
  const shown = shownCollection(collection)
  const since = seenBefore ?? collection.seenAt
  // A paper the memo names opens as its row, where it is in the list
  const openRow = (paperId: string) => {
    if (!shown.rows.some((r) => r.id === paperId)) return false
    set({ peek: paperId })
    requestAnimationFrame(() => document.getElementById(`row-${paperId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    return true
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: t`Collections`, to: "/collections" }, ...(collection.project ? [{ label: collection.project, to: "/collections" }] : [])]} current={shown.title}>
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
        <article className="mx-auto w-full max-w-3xl px-4 pt-8 pb-32">
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
          <Memo collection={collection} shown={shown} seenBefore={since} onRow={openRow} />
          <AnswerRows collection={collection} shown={shown} seenBefore={since} />
          <About collection={collection} />
        </article>
      </div>
    </div>
  )
}

// Where the collection came from and how far Owlit looked: kept, but at the end, so the page opens on the
// reading itself
function About({ collection: c }: { collection: Collection }) {
  const chat = useChatStore((s) => (c.asked.chatId ? s.chats[c.asked.chatId] : undefined))
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
  const asked = c.asked.text
  const when = shortDate(c.asked.at)
  const from = c.asked.chatId && (chat || !isDesktop) ? chatUri(c.asked.chatId) : undefined
  const chatTitle = chat?.title || t`a chat`
  return (
    <section className="mt-12 max-w-[68ch] text-detail leading-relaxed text-muted-foreground">
      <GroupLabel className="px-0">{t`About this collection`}</GroupLabel>
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
      </p>
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
      {looked && <p className="mt-0.5">{looked} {t`The list above is Owlit's reading of them. Grey answers come from an abstract; a page number points to the words an answer rests on.`}</p>}
      {c.watch && <p className="mt-0.5">{t`Owlit watches for new papers on this question.`}</p>}
    </section>
  )
}
