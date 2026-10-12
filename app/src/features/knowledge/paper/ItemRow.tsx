import { useState } from "react"
import { cn } from "@/lib/utils"
import { NoteDot } from "@/components/marks"
import { MentionLink, MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { Button } from "@/components/ui/button"
import { useAgentWindow } from "@/features/agent/store"
import { paperMentionable } from "@/features/docs/lib/mentions"
import { displayName } from "@/features/docs/types"
import { useReaderStore } from "@/features/library/reader/reader-store"
import type { Paper } from "@/features/library/types"
import { shortDate } from "@/lib/time"
import { toastUndo } from "@/lib/toast"
import { SentenceEditor } from "../components/bits"
import { isAbstractOnly, isOwlit, isYou, verbOf } from "../format"
import { dismissConnection, editLine, setConnection } from "../store"
import type { Connection, Passage, Topic } from "../types"
import { findInPaper } from "./find"
import type { Item, Who } from "./items"

const sectionOf = (p: Passage) => p.section || (p.page !== undefined ? `p. ${p.page + 1}` : "Passage")

// A topic, opened at one of its lines or questions
function TopicLink({ topic, block }: { topic: Topic; block?: string }) {
  return <MentionLink label={topic.name} to={`/knowledge/${topic.id}${block ? `#${block}` : ""}`} />
}

function WhoLine({ who }: { who: Who }) {
  if (who.kind === "doc")
    return (
      <>
        You wrote in <MentionLink label={displayName(who.file.path)} to={`/docs/${who.file.id}`} /> · {shortDate(who.at)}
      </>
    )
  if (who.kind === "question")
    return (
      <>
        Your question in <TopicLink topic={who.topic} block={who.questionId} />
      </>
    )
  const at = <TopicLink topic={who.topic} block={who.line.id} />
  if (who.kind === "taken") return <>In {at}</>
  if (isYou(who.line))
    return (
      <>
        You {verbOf(who.line)} in {at}
      </>
    )
  if (isOwlit(who.line)) return <>Owlit thinks in {at}</>
  return (
    <>
      You took from {who.line.speaker} in {at}
    </>
  )
}

export function ItemRow({ item, paper }: { item: Item; paper: Paper }) {
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
        <span>
          <WhoLine who={item.who} />
        </span>
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
            <Button variant="text" size="inline" onClick={() => setEditing(true)} className="ml-1.5 opacity-0 group-hover/item:opacity-100 focus-key:opacity-100">
              Edit
            </Button>
          </p>
        )
      ) : (
        // The user knows what they wrote: their words are the quiet part, the relation is the payoff
        <p className="mt-0.5 text-detail leading-relaxed text-pretty text-muted-foreground">“{item.words}”</p>
      )}
      <Relation
        item={item}
        passage={passage}
        onJump={jump}
        paper={paper}
        fold={
          passage && (
            <Button variant="text" size="inline" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn("ml-1 focus-key:opacity-100", !open && "opacity-0 group-hover/item:opacity-100")}>
              {open ? "Hide passage" : "Passage"}
            </Button>
          )
        }
      />
      {passage && open && <Quote className="mt-2">{passage.text}</Quote>}
      {item.group === "might" && item.connection && (
        <div className="mt-1 -ml-1.5 flex flex-wrap items-center gap-x-0.5">
          <MightActions connection={item.connection} paper={paper} passage={passage} />
        </div>
      )}
    </li>
  )
}

// The relation in one sentence, opening with the section it rests on; the Passage toggle sits at its end.
// A taken line needs no sentence: the group says what it is, so only its section and passage follow.
function Relation({ item, passage, onJump, paper, fold }: { item: Item; passage?: Passage; onJump: () => void; paper: Paper; fold?: React.ReactNode }) {
  const section = passage && <MentionToken label={sectionOf(passage)} onClick={onJump} />
  const find = <MentionToken label="Find it in the paper" onClick={() => item.taken && void findInPaper(paper.id, item.taken.topic.id, item.taken.line.id)} />
  if (item.taken) {
    const { line, found } = item.taken
    if (found)
      return (
        <p className="mt-1 flex items-center gap-1.5 text-detail leading-relaxed text-muted-foreground">
          <NoteDot label="Found by you" />
          <span>
            {section} is the passage you highlighted. Owlit rewrites the line from it when you close the paper.
            {fold}
          </span>
        </p>
      )
    if (isAbstractOnly(line))
      return (
        <p className="mt-1 text-detail leading-relaxed text-muted-foreground">
          From the abstract only. {find}
        </p>
      )
    if (!passage)
      return (
        <p className="mt-1 text-detail leading-relaxed text-muted-foreground">
          Its passage isn’t in this copy of the paper. {find}
        </p>
      )
    return (
      <p className="mt-1 text-detail leading-relaxed text-muted-foreground">
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

// A guess: the user connects it, says it isn't related, or asks. Both answers show a toast with Undo.
function MightActions({ connection, paper, passage }: { connection: Connection; paper: Paper; passage?: Passage }) {
  const connect = () => {
    const was = { kind: connection.kind, relation: connection.relation }
    // "may touch it: …" becomes "touches it: …" once the user has said so
    const relation = connection.relation.replace(/^may (\w+) it/, (_, v: string) => `${v}${/(s|sh|ch|x)$/.test(v) ? "es" : "s"} it`)
    setConnection(paper.id, connection.id, { kind: "backs", relation })
    toastUndo("Connected", () => setConnection(paper.id, connection.id, was), { description: "It now sits under Backs what you have." })
  }
  return (
    <>
      <Button variant="text" size="inline" onClick={connect}>
        Connect
      </Button>
      <Button
        variant="text"
        size="inline"
        onClick={() => {
          const undo = dismissConnection(paper.id, connection.id)
          toastUndo("Marked as not related", undo)
        }}
      >
        Not related
      </Button>
      <Button variant="text" size="inline" onClick={() => useAgentWindow.getState().open(passage ? { text: passage.text, source: paperMentionable(paper) } : undefined)}>
        Ask Owlit
      </Button>
    </>
  )
}
