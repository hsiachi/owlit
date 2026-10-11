import { useCallback } from "react"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { NoteDot } from "@/components/marks"
import { useAgentWindow } from "@/features/agent/store"
import { shortDate } from "@/lib/time"
import { toastUndo } from "@/lib/toast"
import { lineKey, topicUri, wasBefore } from "../format"
import { useTarget, useViewed } from "../hooks"
import { editLine, removeLine } from "../store"
import type { Line, Topic, TopicSidecar } from "../types"
import { useKnowledgeUi } from "../ui-store"
import { SentenceEditor } from "./bits"
import { DatedRows, type DatedRow } from "./DatedRows"
import { LineBody, TopicLine } from "./TopicLine"

// A line on the topic page: a click opens its history under it, the menu edits, asks about or removes it
export function LineRow({
  topic,
  line,
  side,
  seenBefore,
  fresh,
  onViewed,
}: {
  topic: Topic
  line: Line
  side: TopicSidecar
  seenBefore: number
  fresh: "new" | "changed" | null
  onViewed: (id: string) => void
}) {
  const key = lineKey(topic.id, line.id)
  const editing = useKnowledgeUi((s) => s.editing === key)
  const open = useKnowledgeUi((s) => s.open === key)
  const set = useKnowledgeUi((s) => s.set)
  const { ref, hit } = useTarget(line.id)
  const viewedRef = useViewed(
    !!fresh,
    useCallback(() => onViewed(line.id), [onViewed, line.id]),
  )
  const was = fresh === "changed" && !open ? wasBefore(line.id, side, seenBefore) : undefined

  const remove = () => {
    const undo = removeLine(topic.id, line.id)
    if (undo) toastUndo("Line removed", undo, { description: "Updates won’t bring it back." })
  }
  const ask = () =>
    useAgentWindow.getState().open({ text: line.text, source: { id: key, kind: "knowledge", title: topic.name, uri: topicUri(topic.id, line.id) } })
  const toggle = () => set({ open: open ? null : key })
  const menu: MenuGroups = editing
    ? []
    : [
        [
          { label: "Edit", onSelect: () => set({ editing: key, open: null }) },
          // Once the menu has closed, so it doesn't take focus back from the agent window
          { label: "Ask Owlit", afterClose: true, onSelect: ask },
        ],
        [{ label: "Remove", destructive: true, onSelect: remove }],
      ]

  return (
    <ActionsOnRightClick groups={menu}>
      <TopicLine
        line={line}
        mark={fresh && <NoteDot className="absolute top-[9px] -left-3.5" label={fresh === "changed" ? "Changed since you last looked" : "New since you last looked"} />}
        ref={(el) => {
          ref.current = el
          viewedRef.current = el
        }}
        id={line.id}
        tabIndex={editing ? -1 : 0}
        aria-expanded={open}
        className={cn(
          "group/row relative rounded-md px-2 py-2 outline-none transition-colors",
          !editing && "cursor-pointer hover:bg-muted/60 focus-key:bg-muted/60 has-data-[state=open]:bg-muted/60 data-[state=open]:bg-muted/60",
          open && "bg-muted/60",
          hit && "animate-highlight-flash",
        )}
        onClick={(e) => {
          if (editing || (e.target as HTMLElement).closest("button, a, [role=menuitem], textarea")) return
          if (window.getSelection()?.toString()) return
          toggle()
        }}
        onKeyDown={(e) => {
          if (editing || e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <div className="min-w-0 pr-8">
          {editing ? (
            <SentenceEditor
              value={line.text}
              className="text-body leading-relaxed"
              onCancel={() => set({ editing: null })}
              onSave={(text) => {
                editLine(topic.id, line.id, text)
                set({ editing: null })
              }}
            />
          ) : (
            <LineBody line={line} was={was} />
          )}
          {open && !editing && <LineHistory topic={topic} line={line} side={side} />}
        </div>
        {!editing && <RowMenuButton groups={menu} label="Line actions" className="absolute top-2 right-1.5" />}
      </TopicLine>
    </ActionsOnRightClick>
  )
}

// Where a line came from and how it changed, ruled off under it
function LineHistory({ topic, line, side }: { topic: Topic; line: Line; side: TopicSidecar }) {
  const rows: (DatedRow & { at: number })[] = side.history
    .filter((h) => h.lineId === line.id)
    .map((h) => ({
      key: h.id,
      at: h.at,
      date: shortDate(h.at),
      text: (
        <>
          {h.what} <span className="text-muted-foreground">· {h.why}</span>
          {h.before && <span className="block text-muted-foreground">Was: “{h.before}”</span>}
        </>
      ),
    }))
  for (const [i, s] of (side.said[line.id] ?? []).entries())
    rows.push({ key: `said-${i}`, at: s.at, date: shortDate(s.at), text: <span className="text-muted-foreground">You said: “{s.text}”</span> })
  if (!side.history.some((h) => h.lineId === line.id && h.what === "Added")) {
    const start = side.history.filter((h) => !h.lineId).at(-1)
    const at = start?.at ?? topic.updatedAt
    rows.push({ key: "start", at, date: shortDate(at), text: <>In this topic since it began {start && <span className="text-muted-foreground">· {start.why}</span>}</> })
  }
  rows.sort((a, b) => a.at - b.at)
  return <DatedRows rows={rows} className="mt-2.5 border-t pt-2.5 text-detail" />
}
