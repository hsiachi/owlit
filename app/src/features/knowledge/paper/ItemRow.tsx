import { useState } from "react"
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
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
import { isAbstractOnly, isOwlit, isYou, verbOf, verbWords } from "../format"
import { dismissConnection, editLine, setConnection } from "../store"
import type { Connection, Passage, Topic } from "../types"
import { findInPaper } from "./find"
import type { Item, Who } from "./items"

function sectionOf(p: Passage) {
  if (p.section) return p.section
  if (p.page === undefined) return t({ message: "Passage", comment: "a passage of a paper, when it has no section or page" })
  const page = p.page + 1
  return t`p. ${page}`
}

// A topic, opened at one of its lines or questions
function TopicLink({ topic, block }: { topic: Topic; block?: string }) {
  return <MentionLink label={topic.name} to={`/knowledge/${topic.id}${block ? `#${block}` : ""}`} />
}

function WhoLine({ who }: { who: Who }) {
  if (who.kind === "doc") {
    const date = shortDate(who.at)
    return (
      <Trans>
        You wrote in <MentionLink label={displayName(who.file.path)} to={`/docs/${who.file.id}`} /> · {date}
      </Trans>
    )
  }
  if (who.kind === "question")
    return (
      <Trans>
        Your question in <TopicLink topic={who.topic} block={who.questionId} />
      </Trans>
    )
  const at = <TopicLink topic={who.topic} block={who.line.id} />
  if (who.kind === "taken") return <Trans>In {at}</Trans>
  if (isYou(who.line)) {
    const verb = verbWords(verbOf(who.line))
    return <Trans>You {verb} in {at}</Trans>
  }
  if (isOwlit(who.line)) return <Trans>Owlit thinks in {at}</Trans>
  const speaker = who.line.speaker
  return <Trans>You took from {speaker} in {at}</Trans>
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
        {item.fresh && <NoteDot label={t`New since you last looked`} />}
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
              {t({ message: "Edit", comment: "verb: edit a topic's line" })}
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
              {open ? t`Hide passage` : t({ message: "Passage", comment: "button that shows the paper's passage behind an item" })}
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
  const find = <MentionToken label={t`Find it in the paper`}onClick={() => item.taken && void findInPaper(paper.id, item.taken.topic.id, item.taken.line.id)} />
  if (item.taken) {
    const { line, found } = item.taken
    if (found)
      return (
        <p className="mt-1 flex items-center gap-1.5 text-detail leading-relaxed text-muted-foreground">
          <NoteDot label={t`Found by you`} />
          <span>
            <Trans>{section} is the passage you highlighted. Owlit rewrites the line from it when you close the paper.</Trans>
            {fold}
          </span>
        </p>
      )
    if (isAbstractOnly(line))
      return (
        <p className="mt-1 text-detail leading-relaxed text-muted-foreground">
          {t`From the abstract only.`} {find}
        </p>
      )
    if (!passage)
      return (
        <p className="mt-1 text-detail leading-relaxed text-muted-foreground">
          {t`Its passage isn’t in this copy of the paper.`} {find}
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
        <span className="text-muted-foreground">{t`A passage not in this copy`}</span> {item.relation}
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
    toastUndo(t`Connected`, () => setConnection(paper.id, connection.id, was), { description: t`It now sits under Backs what you have.` })
  }
  return (
    <>
      <Button variant="text" size="inline" onClick={connect}>
        {t({ message: "Connect", comment: "verb: accept Owlit's guess that a passage connects to what you have" })}
      </Button>
      <Button
        variant="text"
        size="inline"
        onClick={() => {
          const undo = dismissConnection(paper.id, connection.id)
          toastUndo(t`Marked as not related`, undo)
        }}
      >
        {t`Not related`}
      </Button>
      <Button variant="text" size="inline" onClick={() => useAgentWindow.getState().open(passage ? { text: passage.text, source: paperMentionable(paper) } : undefined)}>
        {t`Ask Owlit`}
      </Button>
    </>
  )
}
