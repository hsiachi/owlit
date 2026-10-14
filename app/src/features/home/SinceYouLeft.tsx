import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { shownCollection } from "@owlit/protocol"
import { GroupLabel } from "@/components/group-label"
import { KindIcon } from "@/components/kind-icon"
import { ListRow } from "@/components/list-row"
import { NoteDot } from "@/components/marks"
import { useLibraryStore } from "@/features/library/store"
import { useCollectionsStore } from "@/features/collections/store"
import { ago, DAY, shortDate } from "@/lib/time"
import { KIND_ICON } from "@/lib/kinds"
import { useChatStore } from "@/features/chat/store"
import { useSeenStore } from "@/features/chat/status"
import { plural, t } from "@lingui/core/macro"

// After three days or more away: one row per chat whose work finished meanwhile and that the user hasn't
// opened since (the jobs they handed off before leaving), one row per collection Owlit started or added
// to meanwhile, and one line for papers Owlit added to the Library. It belongs to this launch only; what
// the user doesn't open keeps its dot in Collections.

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

export function SinceYouLeft({ since }: { since: number }) {
  const navigate = useNavigate()
  const collections = useCollectionsStore((s) => s.collections)
  const papers = useLibraryStore((s) => s.papers)

  const changed = useMemo<Changed[]>(
    () =>
      Object.values(collections)
        .filter((c) => c.updatedAt > since && (c.createdAt > since || Object.values(c.changedAt).some((at) => at > since)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => {
          const shown = shownCollection(c)
          const added = shown.rows.filter((r) => r.addedAt > since).length
          const what =
            c.createdAt > since
              ? plural(shown.rows.length, { one: "New collection · # paper", other: "New collection · # papers" })
              : added
                ? plural(added, { one: "# new paper", other: "# new papers" })
                : t({ message: "Changed", comment: "a collection Owlit changed without adding papers" })
          return { id: c.id, title: shown.title, what, unseen: c.seenAt === 0 || Object.values(c.changedAt).some((at) => at > c.seenAt) }
        }),
    [collections, since],
  )
  const added = useMemo(() => Object.values(papers).filter((p) => p.addedBy === "agent" && p.addedAt > since).length, [papers, since])
  // The chat list's own mark, "Finished since you last looked", limited to replies that ended while away;
  // opening the chat takes it off, here as in the list
  const chats = useChatStore((s) => s.chats)
  const unseenChats = useSeenStore((s) => s.unseen)
  const finished = useMemo<Finished[]>(
    () =>
      Object.values(chats)
        .flatMap((c) => {
          if (unseenChats[c.id] !== "finished") return []
          const last = c.messages.at(-1)
          const at = last?.role === "assistant" ? last.finishedAt : undefined
          return at && at > since ? [{ id: c.id, title: c.title, at }] : []
        })
        .sort((a, b) => b.at - a.at),
    [chats, unseenChats, since],
  )

  if (!changed.length && !added && !finished.length) return null

  const left = shortDate(since)
  return (
    <section className="mt-8">
      <GroupLabel>{t`Since you left on ${left}`}</GroupLabel>
      <div className="flex flex-col gap-0.5">
        {finished.map((f) => {
          const when = ago(f.at, { inSentence: true })
          return <ListRow key={f.id} to={`/chat/${f.id}`} icon={KIND_ICON.chat} title={f.title} end={t`Finished ${when}`} />
        })}
        {changed.map((c) => (
          <ListRow key={c.id} to={`/collections/${c.id}`} mark={<NoteDot gone={!c.unseen} />} title={c.title} detail={c.what} />
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
