import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { t } from "@lingui/core/macro"
import { BorderedList } from "@/components/bordered-list"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { speakerName } from "../format"
import { getTopic, splitTopic } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"

// Split…: pick the lines that leave, name the new topic
export function SplitDialog() {
  const navigate = useNavigate()
  const splitting = useKnowledgeUi((s) => s.splitting)
  const set = useKnowledgeUi((s) => s.set)
  const topic = splitting ? getTopic(splitting) : undefined
  return (
    <Dialog open={!!topic} onOpenChange={(open) => !open && set({ splitting: null })}>
      {topic && (
        <SplitForm
          key={topic.id}
          topic={topic}
          onDone={(id) => {
            set({ splitting: null })
            if (id) navigate(`/knowledge/${id}`)
          }}
        />
      )}
    </Dialog>
  )
}

function SplitForm({ topic, onDone }: { topic: Topic; onDone: (id: string | null) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState("")
  const ok = picked.length > 0 && picked.length < topic.lines.length && name.trim().length > 0
  const topicName = topic.name
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t`Split ${topicName}`}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onDone(splitTopic(topic.id, picked, name))
        }}
      >
        <BorderedList as="ul">
          {topic.lines.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm leading-snug">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(l.id)}
                  onCheckedChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))}
                />
                <span>
                  <span className="text-muted-foreground">{speakerName(l)} · </span>
                  {l.text}
                </span>
              </label>
            </li>
          ))}
        </BorderedList>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t`New topic`}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t({ message: "Name", comment: "placeholder: the new topic's name" })}
            className="h-9 rounded-md border bg-card px-3 text-sm outline-none focus-visible:border-foreground/30"
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onDone(null)}>
            {t`Cancel`}
          </Button>
          <Button type="submit" disabled={!ok}>
            {t({ message: "Split", comment: "verb: split a topic in two" })}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
