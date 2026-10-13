import { useNavigate } from "react-router-dom"
import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { ActionsDropdownContent, MenuItems, type MenuGroups } from "@/components/action-menu"
import { isDesktop, rpc } from "@/lib/rpc"
import { dayLabel } from "@/lib/time"
import { toastUndo } from "@/lib/toast"
import { runUpdates } from "../runner"
import { deleteTopic, mergeTopic, setArchived, useKnowledgeStore, useTopics } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"

// Rename, Merge into…, Split…, Archive, Update now, Pause updates, Delete. The same menu from a row's ⋯,
// a right-click on the row and the topic page's header.
function useTopicMenu(topic: Topic, afterDelete?: () => void): MenuGroups {
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
        .then(() => toast(t`Owlit is updating Knowledge`, { description: t`It reads what changed since the last update.` }))
        .catch((error: Error) => toast.error(error.message))
      return
    }
    const [item] = runUpdates([topic.id])
    const last = topic.sources[0]?.date
    const name = topic.name
    const day = last ? dayLabel(last) : ""
    toast(item ? t`Updated · ${name}` : t`Nothing new`, {
      description: item ? item.what : last ? t`Nothing has changed in its sources since ${day}.` : t`Nothing has changed in its sources.`,
    })
  }

  return [
    [
      { label: t({ message: "Rename", comment: "verb: rename a topic" }), afterClose: true, onSelect: () => set({ renaming: topic.id }) },
      {
        label: t`Merge into`,
        childrenClassName: "w-56",
        children: others.map((other) => ({
          label: other.name,
          onSelect: () => {
            const undo = mergeTopic(topic.id, other.id)
            if (!undo) return
            navigate(`/knowledge/${other.id}`)
            const into = other.name
            toastUndo(t`Merged into ${into}`, () => (undo(), navigate(`/knowledge/${topic.id}`)))
          },
        })),
      },
      { label: t({ message: "Split…", comment: "verb: split a topic in two" }), disabled: topic.lines.length < 2, onSelect: () => set({ splitting: topic.id }) },
      { label: topic.archived ? t`Unarchive` : t({ message: "Archive", comment: "verb: archive a topic" }), onSelect: () => setArchived(topic.id, !topic.archived) },
    ],
    [
      { label: t`Update now`, disabled: paused, onSelect: update },
      { label: paused ? t`Resume updates` : t`Pause updates`, onSelect: () => setPaused(topic.id, !paused) },
    ],
    [
      {
        label: t({ message: "Delete", comment: "verb: delete a topic" }),
        destructive: true,
        onSelect: () => {
          const undo = deleteTopic(topic.id)
          if (!undo) return
          afterDelete?.()
          const name = topic.name
          toastUndo(t`Deleted ${name}`, undo)
        },
      },
    ],
  ]
}

// The menu's items, for a row's ⋯ or right-click. Menus mount their items only while open, so a list of
// closed rows doesn't each read every topic.
export function TopicMenuItems({ topic, afterDelete }: { topic: Topic; afterDelete?: () => void }) {
  return <MenuItems groups={useTopicMenu(topic, afterDelete)} />
}

// The menu from the topic page's header
export function TopicMenuContent({ topic, afterDelete }: { topic: Topic; afterDelete?: () => void }) {
  return (
    <ActionsDropdownContent align="end" className="w-48">
      <TopicMenuItems topic={topic} afterDelete={afterDelete} />
    </ActionsDropdownContent>
  )
}
