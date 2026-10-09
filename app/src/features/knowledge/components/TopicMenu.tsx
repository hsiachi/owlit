import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { runUpdates } from "../runner"
import { deleteTopic, getTopic, mergeTopic, setArchived, splitTopic, useKnowledgeStore, useTopics } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"
import { dayLabel } from "../lib/when"

// Rename, Merge into…, Split…, Archive, Update now, Pause updates, Delete. The same menu on a row of the
// list and in the topic page's header.
export function TopicMenuContent({ topic, align = "end", afterDelete }: { topic: Topic; align?: "start" | "end"; afterDelete?: () => void }) {
  const navigate = useNavigate()
  const others = useTopics().filter((t) => t.id !== topic.id && !t.archived)
  const paused = useKnowledgeStore((s) => !!s.topics[topic.id]?.paused)
  const setPaused = useKnowledgeStore((s) => s.setPaused)
  const set = useKnowledgeUi((s) => s.set)

  const update = () => {
    const [item] = runUpdates([topic.id])
    const last = topic.sources[0]?.date
    toast(item ? `Updated · ${topic.name}` : "Nothing new", {
      description: item ? item.what : `Nothing has changed in its sources${last ? ` since ${dayLabel(last)}` : ""}.`,
    })
  }

  return (
    <DropdownMenuContent align={align} className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
      <DropdownMenuItem onSelect={() => set({ renaming: topic.id })}>Rename</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!others.length}>Merge into</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          {others.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => {
                const undo = mergeTopic(topic.id, t.id)
                if (!undo) return
                navigate(`/knowledge/${t.id}`)
                toast(`Merged into ${t.name}`, { action: { label: "Undo", onClick: () => (undo(), navigate(`/knowledge/${topic.id}`)) } })
              }}
            >
              <span className="truncate">{t.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem disabled={topic.lines.length < 2} onSelect={() => set({ splitting: topic.id })}>
        Split…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setArchived(topic.id, !topic.archived)}>{topic.archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={paused} onSelect={update}>
        Update now
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setPaused(topic.id, !paused)}>{paused ? "Resume updates" : "Pause updates"}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => {
          const undo = deleteTopic(topic.id)
          if (!undo) return
          afterDelete?.()
          toast(`Deleted ${topic.name}`, { action: { label: "Undo", onClick: undo } })
        }}
      >
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

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
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Split {topic.name}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onDone(splitTopic(topic.id, picked, name))
        }}
      >
        <ul className="flex flex-col divide-y rounded-lg border">
          {topic.lines.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm leading-snug">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(l.id)}
                  onCheckedChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))}
                />
                <span>
                  <span className="text-muted-foreground">{l.speaker} · </span>
                  {l.text}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">New topic</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-9 rounded-md border bg-card px-3 text-sm outline-none focus-visible:border-foreground/30"
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ok}>
            Split
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

