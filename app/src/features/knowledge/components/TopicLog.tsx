import { useState } from "react"
import { FoldButton } from "@/components/fold"
import { MentionToken } from "@/components/mention/mention-token"
import { dayLabel, shortDate } from "@/lib/time"
import { plural } from "@/lib/words"
import { changeGroups, firstWords, shownChange, wordsAfter } from "../format"
import { ringBlock } from "../lib/ring"
import { provenance } from "../store"
import type { Change, Topic } from "../types"
import { Prose, Refs } from "./bits"
import { DatedRows } from "./DatedRows"

// Every line already carries its source, so the topic's list of them stays folded: when each came in and how
// it was used
export function Sources({ topic }: { topic: Topic }) {
  const [open, setOpen] = useState(false)
  if (!topic.sources.length) return null
  return (
    <section className="mt-10">
      <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
        Sources · {provenance(topic)}
      </FoldButton>
      {open && (
        <DatedRows
          className="mt-2 text-sm"
          rows={topic.sources.map((s, i) => ({
            key: i,
            date: dayLabel(s.date),
            text: (
              <>
                <Refs refs={[s.ref]} />
                {s.how && <span className="text-muted-foreground"> · {s.how}</span>}
              </>
            ),
          }))}
        />
      )}
    </section>
  )
}

// The change log names a line by its opening words, which open it; nothing on the page is numbered. Changes
// Owlit made together sit under one date with their reason once, the lines it touched listed under it.
export function Changes({ topic, history }: { topic: Topic; history: Change[] }) {
  const [open, setOpen] = useState(false)
  if (!history.length) return null
  const after = wordsAfter(history, (id) => (topic.lines.find((l) => l.id === id) ?? topic.questions.find((q) => q.id === id))?.text)
  const subject = (h: Change): React.ReactNode => {
    if (!h.lineId) return null
    const block = topic.lines.find((l) => l.id === h.lineId) ?? topic.questions.find((q) => q.id === h.lineId)
    if (block) return <MentionToken label={`“${firstWords(block.text)}”`} title={block.text} onClick={() => ringBlock(block.id)} />
    return h.before ? <>“{firstWords(h.before)}”</> : "A line"
  }
  // "“Retrieval and tool use may…” rewritten", or the change alone when it isn't about one line
  const change = (h: Change) => {
    const who = subject(h)
    const { what } = shownChange(h, after.get(h.id))
    return who ? (
      <>
        {who} {what.charAt(0).toLowerCase() + what.slice(1)}
      </>
    ) : (
      what
    )
  }
  return (
    <section className="mt-6">
      <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
        {plural(history.length, "change")}
      </FoldButton>
      {open && (
        <DatedRows
          className="mt-2 text-detail"
          rows={changeGroups(history).map((group) => {
            const [h] = group
            const why = <Prose text={h.why} topic={topic} />
            return {
              key: h.id,
              date: shortDate(h.at),
              text:
                group.length === 1 ? (
                  <>
                    {change(h)} <span className="text-muted-foreground">· {why}</span>
                  </>
                ) : (
                  <>
                    <span className="block text-muted-foreground">{why}</span>
                    {group.map((c) => (
                      <span key={c.id} className="block">
                        {change(c)}
                      </span>
                    ))}
                  </>
                ),
            }
          })}
        />
      )}
    </section>
  )
}
