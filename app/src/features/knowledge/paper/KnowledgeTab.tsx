import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAgentWindow } from "@/features/agent/store"
import { MentionToken } from "@/features/chat/components/composer/MentionToken"
import { useChatStore } from "@/features/chat/store"
import { paperMentionable } from "@/features/docs/lib/mentions"
import { isHidden } from "@/features/docs/lib/tree"
import { useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { useReaderStore } from "@/features/library/reader/reader-store"
import type { Paper } from "@/features/library/types"
import { Info, NoteDot, SentenceEditor } from "../components/bits"
import { isAbstractOnly, paperRef, verbOf } from "../format"
import { shortDate } from "../lib/when"
import { dismissConnection, editLine, setConnection, useKnowledgeStore, usePaperKnowledge, useTopics } from "../store"
import type { Connection, ConnectionKind, Line, PaperKnowledge, Passage, Topic } from "../types"
import { findInPaper } from "./find"

// How this paper relates to what the user already has. Each item pairs something they have (their words,
// a question, a line in a topic) with a passage of the paper; the group says the relation.

type Group = ConnectionKind | "taken"

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

interface Item {
  key: string
  group: Group
  who: React.ReactNode
  words: string
  muted?: boolean
  passage?: Passage
  relation?: string
  fresh?: boolean
  connection?: Connection
  taken?: { topic: Topic; line: Line; found?: Passage }
}

const sectionOf = (p: Passage) => p.section || (p.page !== undefined ? `p. ${p.page + 1}` : "Passage")

function TopicLink({ topic, block }: { topic: Topic; block?: string }) {
  const navigate = useNavigate()
  return <MentionToken label={topic.name} onClick={() => navigate(`/knowledge/${topic.id}${block ? `#${block}` : ""}`)} />
}

// Everything the tab shows, in group order
function useItems(paper: Paper, k: PaperKnowledge, seenBefore: number): Item[] {
  const topics = useTopics()
  const files = useDocsStore((s) => s.files)
  return useMemo(() => {
    const byId = new Map(topics.map((t) => [t.id, t]))
    const items: Item[] = []
    for (const c of k.connections) {
      if (k.dismissed.includes(c.id)) continue
      const passage = k.passages[c.passageId]
      const base = { key: c.id, group: c.kind, passage, relation: c.relation, connection: c, fresh: c.kind === "might" && c.createdAt > seenBefore }
      const h = c.have
      if (h.kind === "doc") {
        const file = Object.values(files).find((f) => f.path === h.path)
        if (!file) continue
        items.push({
          ...base,
          who: (
            <>
              You wrote in <DocLink id={file.id} path={file.path} /> · {shortDate(h.at)}
            </>
          ),
          words: h.quote.replace(/\$([^$]+)\$/g, "$1"),
        })
        continue
      }
      const topic = byId.get(h.topicId)
      if (!topic || topic.archived) continue
      if (h.kind === "question") {
        const q = topic.questions.find((x) => x.id === h.questionId)
        if (!q) continue
        items.push({ ...base, who: <>Your question in <TopicLink topic={topic} block={q.id} /></>, words: q.text })
        continue
      }
      const line = topic.lines.find((x) => x.id === h.lineId)
      if (!line) continue
      const verb = verbOf(line)
      const who =
        line.speaker === "You" ? (
          <>
            You {verb} in <TopicLink topic={topic} block={line.id} />
          </>
        ) : line.speaker === "Owlit" ? (
          <>
            Owlit thinks in <TopicLink topic={topic} block={line.id} />
          </>
        ) : (
          <>
            You took from {line.speaker} in <TopicLink topic={topic} block={line.id} />
          </>
        )
      items.push({ ...base, who, words: line.text })
    }

    // Lines a topic took from this paper: the paper speaks them
    for (const topic of topics) {
      if (topic.archived) continue
      for (const line of topic.lines) {
        if (line.speaker === "You" || line.speaker === "Owlit") continue
        const ref = line.sources.map((r) => paperRef(r.uri)).find((r) => r?.paperId === paper.id)
        if (!ref) continue
        const found = k.found?.[`${topic.id}/${line.id}`]
        items.push({
          key: `${topic.id}/${line.id}`,
          group: "taken",
          who: (
            <>
              In <TopicLink topic={topic} block={line.id} />
            </>
          ),
          words: line.text,
          muted: isAbstractOnly(line),
          passage: ref.passageId ? k.passages[ref.passageId] : undefined,
          taken: { topic, line, found: found ? k.passages[found.passageId] : undefined },
        })
      }
    }
    return items
  }, [topics, files, k, paper.id, seenBefore])
}

function DocLink({ id, path }: { id: string; path: string }) {
  const navigate = useNavigate()
  return <MentionToken label={displayName(path)} onClick={() => navigate(`/docs/${id}`)} />
}

// The tab label carries no count, only the dot while a guess is unseen
export function KnowledgeTabLabel({ paper }: { paper: Paper }) {
  const k = usePaperKnowledge(paper.id)
  const items = useItems(paper, k, k.seenAt)
  const unseen = items.some((i) => i.fresh)
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
  const items = useItems(paper, k, seenBefore)
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length)

  return (
    <div className="flex flex-col gap-7 pb-6">
      {items.length === 0 && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Nothing here yet. Owlit connects a paper to your notes, questions and topics once you read, highlight, cite or talk about it.
        </p>
      )}
      {groups.map((g, n) => (
        <section key={g.id}>
          <h3 className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            {g.label}
            {n === 0 && <Info label="About the Knowledge tab">{ABOUT}</Info>}
          </h3>
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

function ItemRow({ item, paper }: { item: Item; paper: Paper }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const passage = item.taken?.found ?? item.passage
  const api = () => useReaderStore.getState().api

  const jump = () => passage && void api()?.showPassage(passage, "jump")

  return (
    <li
      tabIndex={passage && !editing ? 0 : -1}
      className={cn("group/item rounded-md px-2 py-2 outline-none transition-colors", passage && !editing && "cursor-pointer hover:bg-muted/60 focus-key:bg-muted/60")}
      onMouseEnter={() => passage && void api()?.showPassage(passage, "hover")}
      onMouseLeave={() => passage && useReaderStore.getState().clearHoverRing(passage.id)}
      onClick={(e) => {
        if (editing || (e.target as HTMLElement).closest("button, a, textarea, [role=link]")) return
        if (window.getSelection()?.toString()) return
        jump()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.key !== "Enter") return
        e.preventDefault()
        jump()
      }}
    >
      <p className="flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
        {item.fresh && <NoteDot label="New since you last looked" />}
        <span>{item.who}</span>
      </p>
      {item.taken ? (
        // A line taken from this paper is the thing itself, so it reads in full tone and can be edited here
        editing ? (
          <div className="mt-1.5">
            <SentenceEditor
              value={item.words}
              className="text-sm leading-relaxed"
              onCancel={() => setEditing(false)}
              onSave={(text) => {
                editLine(item.taken!.topic.id, item.taken!.line.id, text)
                setEditing(false)
              }}
            />
          </div>
        ) : (
          <p className={cn("mt-0.5 text-sm leading-relaxed text-pretty", item.muted && !item.taken.found && "text-muted-foreground")}>
            {item.words}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-1.5 rounded px-1 text-xs text-muted-foreground opacity-0 outline-none group-hover/item:opacity-100 hover:bg-muted hover:text-foreground focus-key:opacity-100"
            >
              Edit
            </button>
          </p>
        )
      ) : (
        // The user knows what they wrote: their words are the quiet part, the relation is the payoff
        <p className="mt-0.5 text-[13px] leading-relaxed text-pretty text-muted-foreground">“{item.words}”</p>
      )}
      <Relation
        item={item}
        passage={passage}
        onJump={jump}
        paper={paper}
        fold={
          passage && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={cn(
                "ml-1 rounded-md px-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:opacity-100",
                !open && "opacity-0 group-hover/item:opacity-100",
              )}
            >
              {open ? "Hide passage" : "Passage"}
            </button>
          )
        }
      />
      {passage && open && <Quote passage={passage} />}
      {item.group === "might" && item.connection && (
        <div className="mt-1 -ml-1 flex flex-wrap items-center gap-x-0.5 text-xs">
          <MightActions connection={item.connection} paper={paper} passage={passage} />
        </div>
      )}
    </li>
  )
}

// The relation in one sentence, opening with the section it rests on; the Passage toggle sits at its end.
// A taken line needs no sentence: the group says what it is, so only its section and passage follow.
function Relation({ item, passage, onJump, paper, fold }: { item: Item; passage?: Passage; onJump: () => void; paper: Paper; fold?: React.ReactNode }) {
  const section = passage && (
    <button type="button" onClick={onJump} className="rounded-[0.3em] text-mention outline-none hover:bg-mention/10 focus-key:ring-2 focus-key:ring-ring/50">
      {sectionOf(passage)}
    </button>
  )
  const find = (
    <button
      type="button"
      onClick={() => item.taken && void findInPaper(paper.id, item.taken.topic.id, item.taken.line.id)}
      className="rounded-[0.3em] text-mention outline-none hover:bg-mention/10 focus-key:ring-2 focus-key:ring-ring/50"
    >
      Find it in the paper
    </button>
  )
  if (item.taken) {
    const { line, found } = item.taken
    if (found)
      return (
        <p className="mt-1 flex items-center gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <NoteDot label="Found by you" />
          <span>
            {section} is the passage you highlighted. Owlit rewrites the line from it when you close the paper.
            {fold}
          </span>
        </p>
      )
    if (isAbstractOnly(line))
      return (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          From the abstract only. {find}
        </p>
      )
    if (!passage)
      return (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Its passage isn’t in this copy of the paper. {find}
        </p>
      )
    return (
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        {section}
        {fold}
      </p>
    )
  }
  if (!passage)
    return (
      <p className="mt-1 text-sm leading-relaxed text-pretty">
        <span className="text-muted-foreground">A passage not in this copy</span> {item.relation}
      </p>
    )
  return (
    <p className="mt-1 text-sm leading-relaxed text-pretty">
      {section} {item.relation}
      {fold}
    </p>
  )
}

function Quote({ passage }: { passage: Passage }) {
  return <blockquote className="mt-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">{passage.text}</blockquote>
}

function TextButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md px-1 py-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
      {children}
    </button>
  )
}

// A guess: the user connects it, says it isn't related, or asks. Both answers show a toast with Undo.
function MightActions({ connection, paper, passage }: { connection: Connection; paper: Paper; passage?: Passage }) {
  const connect = () => {
    const was = { kind: connection.kind, relation: connection.relation }
    // "may touch it: …" becomes "touches it: …" once the user has said so
    const relation = connection.relation.replace(/^may (\w+) it/, (_, v: string) => `${v}${/(s|sh|ch|x)$/.test(v) ? "es" : "s"} it`)
    setConnection(paper.id, connection.id, { kind: "backs", relation })
    toast("Connected", { description: "It now sits under Backs what you have.", action: { label: "Undo", onClick: () => setConnection(paper.id, connection.id, was) } })
  }
  return (
    <>
      <TextButton onClick={connect}>Connect</TextButton>
      <TextButton
        onClick={() => {
          const undo = dismissConnection(paper.id, connection.id)
          toast("Marked as not related", { action: { label: "Undo", onClick: undo } })
        }}
      >
        Not related
      </TextButton>
      <TextButton onClick={() => useAgentWindow.getState().open(passage ? { text: passage.text, source: paperMentionable(paper) } : undefined)}>Ask Owlit</TextButton>
    </>
  )
}

// Drafts that cite the paper and chats that mention it
function UsedIn({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const files = useDocsStore((s) => s.files)
  const chats = useChatStore((s) => s.chats)
  const uri = `owlit://library/${paper.id}`
  const docs = useMemo(
    () =>
      Object.values(files)
        .filter((f) => !isHidden(f.path) && f.content && (f.content.includes(`${uri})`) || f.content.includes(`${uri}#`)))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .map((f) => {
          const at = f.content!.indexOf(uri)
          return { file: f, heading: [...f.content!.slice(0, at).matchAll(/^#{2,}\s+(.+)$/gm)].at(-1)?.[1] }
        }),
    [files, uri],
  )
  const talked = useMemo(
    () => Object.values(chats).filter((c) => c.messages.some((m) => m.mentions?.some((x) => x.uri === uri) || m.context?.some((x) => x.uri === uri))),
    [chats, uri],
  )
  if (!docs.length && !talked.length) return null
  return (
    <section>
      <h3 className="mb-2 text-xs text-muted-foreground">Used in</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {docs.map(({ file, heading }) => (
          <li key={file.id}>
            <MentionToken label={displayName(file.path)} onClick={() => navigate(`/docs/${file.id}`)} />
            {heading && <span className="text-muted-foreground"> · {heading}</span>}
          </li>
        ))}
        {talked.map((c) => (
          <li key={c.id}>
            <MentionToken label={c.title} onClick={() => navigate(`/chat/${c.id}`)} />
            <span className="text-muted-foreground"> · chat, {shortDate(c.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
