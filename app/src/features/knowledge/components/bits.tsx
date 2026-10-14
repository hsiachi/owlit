import { useNavigate } from "react-router-dom"
import { Dot } from "@/components/marks"
import { MentionLink, MentionToken } from "@/components/mention/mention-token"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import { firstWords, namedLines } from "../format"
import { ringBlock } from "../lib/ring"
import { knowledgeRoute } from "../mentions"
import type { Ref, Topic } from "../types"

// A source as a mention: a paper passage opens the paper at it, a doc opens the doc
export function RefToken({ r, className }: { r: Ref; className?: string }) {
  return <MentionLink label={r.label} to={mentionRoute(r.uri)} title={mentionTitle(r.uri) ?? r.label} className={className} />
}

export function Refs({ refs }: { refs: Ref[] }) {
  return (
    <>
      {refs.map((r, i) => (
        <span key={`${r.uri}-${i}`}>
          {i > 0 && <Dot />}
          <RefToken r={r} />
        </span>
      ))}
    </>
  )
}

// Owlit's prose about a topic (a question's status, a line's condition, why something changed), with the
// lines it names by ^id as mentions of their opening words. On the topic page a click scrolls to the line and
// rings it; elsewhere it opens the topic there. Without the topic the ids are left out.
export function Prose({ text, topic }: { text: string; topic?: Topic }) {
  const navigate = useNavigate()
  const block = (id: string) => topic?.lines.find((l) => l.id === id) ?? topic?.questions.find((q) => q.id === id)
  return (
    <>
      {namedLines(text, (id) => !!block(id)).map((p, i) => {
        if (typeof p === "string") return p
        const b = block(p.id)!
        const go = () => (document.getElementById(p.id) ? ringBlock(p.id) : navigate(knowledgeRoute({ kind: "knowledge", topicId: topic!.id, block: p.id })))
        return <MentionToken key={i} label={`“${firstWords(b.text, 4)}”`} title={b.text} onClick={go} />
      })}
    </>
  )
}

export { SentenceEditor } from "@/components/sentence-editor"
