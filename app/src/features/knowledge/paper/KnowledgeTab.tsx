import { paperUri } from "@owlit/protocol"
import { useEffect, useMemo, useState } from "react"
import { EmptyPlace } from "@/components/empty-place"
import { GroupLabel } from "@/components/group-label"
import { NoteDot } from "@/components/marks"
import { MentionLink } from "@/components/mention/mention-token"
import { useChatStore } from "@/features/chat/store"
import { filesByPath, useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { shortDate } from "@/lib/time"
import { citingDocs, withAliases } from "../format"
import { topicsOf, useKnowledgeStore, usePaperKnowledge, useTopics } from "../store"
import { ItemRow } from "./ItemRow"
import { hasUnseenGuess, paperItems, type Group } from "./items"

// How this paper relates to what the user already has, grouped by the relation (see ./items)

const GROUPS: { id: Group; label: string }[] = [
  { id: "challenges", label: "Challenges what you have" },
  { id: "backs", label: "Backs what you have" },
  { id: "might", label: "Might connect" },
  { id: "taken", label: "Taken into your topics" },
]

// One explanation for the whole tab, behind one info icon
const ABOUT =
  "Each item pairs a passage of this paper with something you already have: your words, a question, a line in a topic. Challenges and Backs say which way it cuts. Might connect holds Owlit’s guesses until you connect them. Taken into your topics are lines that come from this paper; edit one and it stays in your words."

// The tab counts as looked at once it has been open this long; opening a paper on a remembered tab is not a look
const SEEN_AFTER_MS = 3000

// The tab label carries no count, only the dot while a guess is unseen. It is always on screen, so it reads
// the topics and docs only while there is an unseen guess to check.
export function KnowledgeTabLabel({ paper }: { paper: Paper }) {
  const k = useKnowledgeStore((s) => s.papers[paper.id])
  const unseen = useDocsStore((s) => hasUnseenGuess(k, () => topicsOf(s.files), () => filesByPath(s.files)))
  return (
    <>
      Knowledge
      {unseen && <NoteDot label="Owlit found something new" />}
    </>
  )
}

export function KnowledgeTab({ paper }: { paper: Paper }) {
  const k = usePaperKnowledge(paper.id)
  // What is new stays marked for this visit; the tab counts as seen once it has been open a few seconds, so
  // a paper opened on a remembered Knowledge tab does not clear the dot before the user looks
  const [seenBefore] = useState(() => k.seenAt)
  useEffect(() => {
    const timer = setTimeout(() => useKnowledgeStore.getState().patchPaper(paper.id, () => ({ seenAt: Date.now() })), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [paper.id])
  const topics = useTopics()
  const files = useDocsStore((s) => s.files)
  const items = useMemo(() => paperItems(paper.id, k, topics, filesByPath(files), seenBefore), [paper.id, k, topics, files, seenBefore])
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length)

  return (
    <div className="flex flex-col gap-7 pb-6">
      {items.length === 0 && (
        <EmptyPlace
          size="panel"
          title="Nothing connected yet"
          detail="Owlit links this paper to your notes, questions and topics once you highlight, cite or talk about it."
          className="pt-8"
        />
      )}
      {groups.map((g, n) => (
        <section key={g.id}>
          <GroupLabel as="h3" flush info={n === 0 && ABOUT} infoLabel="About the Knowledge tab">
            {g.label}
          </GroupLabel>
          <ul className="-mx-2 flex flex-col gap-1">
            {g.items.map((i) => (
              <ItemRow key={i.key} item={i} paper={paper} />
            ))}
          </ul>
        </section>
      ))}
      <UsedIn paper={paper} />
    </div>
  )
}

// Docs that cite the paper and chats that mention it
function UsedIn({ paper }: { paper: Paper }) {
  const files = useDocsStore((s) => s.files)
  const chats = useChatStore((s) => s.chats)
  const aliases = useLibraryStore((s) => s.aliases)
  const ids = useMemo(() => withAliases([paper.id], aliases), [paper.id, aliases])
  const docs = useMemo(() => citingDocs(files, ids), [files, ids])
  const talked = useMemo(() => {
    const uris = new Set(ids.map((id) => paperUri(id)))
    return Object.values(chats).filter((c) => c.messages.some((m) => m.mentions?.some((x) => uris.has(x.uri)) || m.context?.some((x) => uris.has(x.uri))))
  }, [chats, ids])
  if (!docs.length && !talked.length) return null
  return (
    <section>
      <GroupLabel as="h3" flush>
        Used in
      </GroupLabel>
      <ul className="flex flex-col gap-1.5 text-sm">
        {docs.map(({ file, heading }) => (
          <li key={file.id}>
            <MentionLink label={displayName(file.path)} to={`/docs/${file.id}`} />
            {heading && <span className="text-muted-foreground"> · {heading}</span>}
          </li>
        ))}
        {talked.map((c) => (
          <li key={c.id}>
            <MentionLink label={c.title} to={`/chat/${c.id}`} />
            <span className="text-muted-foreground"> · chat, {shortDate(c.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
