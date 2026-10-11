import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import type { MenuGroups } from "@/components/action-menu"
import { isDesktop, rpc } from "@/lib/rpc"
import { runUpdates } from "../runner"
import { deleteTopic, mergeTopic, setArchived, useKnowledgeStore, useTopics } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"
import { dayLabel } from "@/lib/time"
import { toastUndo } from "@/lib/toast"

// Rename, Merge into…, Split…, Archive, Update now, Pause updates, Delete. The same menu from a row's ⋯,
// a right-click on the row and the topic page's header.
export function useTopicMenu(topic: Topic, afterDelete?: () => void): MenuGroups {
  const navigate = useNavigate()
  const others = useTopics().filter((t) => t.id !== topic.id && !t.archived)
  const paused = useKnowledgeStore((s) => !!s.topics[topic.id]?.paused)
  const setPaused = useKnowledgeStore((s) => s.setPaused)
  const set = useKnowledgeUi((s) => s.set)

  const update = () => {
    // A real run reads everything that changed, for every topic; what it did shows as "Updated …"
    if (isDesktop) {
      rpc.knowledge
        .update()
        .then(() => toast("Owlit is updating Knowledge", { description: "It reads what changed since the last update." }))
        .catch((error: Error) => toast.error(error.message))
      return
    }
    const [item] = runUpdates([topic.id])
    const last = topic.sources[0]?.date
    toast(item ? `Updated · ${topic.name}` : "Nothing new", {
      description: item ? item.what : `Nothing has changed in its sources${last ? ` since ${dayLabel(last)}` : ""}.`,
    })
  }

  return [
    [
      { label: "Rename", afterClose: true, onSelect: () => set({ renaming: topic.id }) },
      {
        label: "Merge into",
        childrenClassName: "w-56",
        children: others.map((t) => ({
          label: t.name,
          onSelect: () => {
            const undo = mergeTopic(topic.id, t.id)
            if (!undo) return
            navigate(`/knowledge/${t.id}`)
            toastUndo(`Merged into ${t.name}`, () => (undo(), navigate(`/knowledge/${topic.id}`)))
          },
        })),
      },
      { label: "Split…", disabled: topic.lines.length < 2, onSelect: () => set({ splitting: topic.id }) },
      { label: topic.archived ? "Unarchive" : "Archive", onSelect: () => setArchived(topic.id, !topic.archived) },
    ],
    [
      { label: "Update now", disabled: paused, onSelect: update },
      { label: paused ? "Resume updates" : "Pause updates", onSelect: () => setPaused(topic.id, !paused) },
    ],
    [
      {
        label: "Delete",
        destructive: true,
        onSelect: () => {
          const undo = deleteTopic(topic.id)
          if (!undo) return
          afterDelete?.()
          toastUndo(`Deleted ${topic.name}`, undo)
        },
      },
    ],
  ]
}

