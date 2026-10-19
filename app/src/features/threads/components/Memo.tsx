import { t } from "@lingui/core/macro"
import { itemId, parseOwlitUri, type Thread } from "@owlit/protocol"
import { useState } from "react"
import { RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { NoteDot } from "@/components/marks"
import { MentionToken } from "@/components/mention/mention-token"
import { useNavigate } from "react-router-dom"
import { SentenceEditor } from "@/components/sentence-editor"
import { mentionRoute, mentionTitle, usePaperUnread } from "@/features/docs/lib/mentions"
import { cn } from "@/lib/utils"
import { memoParts, plainMemo, relinkMemo } from "../lib"
import { editThread, removeItem } from "../store"

// A sentence of Owlit's (or the user's rewrite of one), with the papers and groups it names as mentions.
// A paper that is a row of the thread opens that row in place (onRow); others go where they live.
export function MemoText({ text, onRow, removed }: { text: string; onRow?: (paperId: string) => boolean; removed?: (paperId: string) => boolean }) {
  return (
    <>
      {memoParts(text).map((p, i) => (typeof p === "string" ? p : <MemoMention key={i} label={p.label} uri={p.uri} onRow={onRow} removed={removed} />))}
    </>
  )
}

// A paper not read yet is lighter until it is, as in docs and chat. One the user took out of the thread is
// struck through: Owlit's sentence still leans on it until Owlit or the user rewrites it.
function MemoMention({ label, uri, onRow, removed }: { label: string; uri: string; onRow?: (paperId: string) => boolean; removed?: (paperId: string) => boolean }) {
  const navigate = useNavigate()
  const unread = usePaperUnread(uri)
  const u = parseOwlitUri(uri)
  const route = mentionRoute(uri)
  if (u?.kind === "paper" && removed?.(u.id))
    return (
      <MentionToken
        label={label}
        title={`${mentionTitle(uri) ?? label} · ${t`Removed from the thread`}`}
        className="text-muted-foreground line-through"
        onClick={route ? () => navigate(route) : undefined}
      />
    )
  const open = u?.kind === "paper" && onRow ? () => onRow(u.id) || (route && navigate(route)) : route ? () => navigate(route) : undefined
  return <MentionToken label={label} title={mentionTitle(uri) ?? label} unread={unread} onClick={open} />
}

// Owlit's reading of the papers, a few sentences as a list. A sentence Owlit changed since the user last
// looked has the dot for its bullet; one the user rewrote says so, with Owlit's words a hover away. Each can
// be rewritten or removed from its ⋯; nothing asks to be accepted.
export function Memo({ thread, shown, seenBefore, onRow }: { thread: Thread; shown: Thread; seenBefore: number; onRow?: (paperId: string) => boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  if (!shown.memo.length) return null
  return (
    <ul className="mt-4 flex max-w-[68ch] flex-col gap-1 text-body leading-relaxed">
      {shown.memo.map((s) => {
        const item = itemId.memo(s.id)
        const edit = thread.overrides.edits[item]
        const fresh = (thread.changedAt[item] ?? 0) > seenBefore && !edit
        const groups: MenuGroups = [
          [
            { label: t({ message: "Rewrite", comment: "verb: change the words of Owlit's sentence" }), onSelect: () => setEditing(s.id), afterClose: true },
            ...(edit ? [{ label: t`Use Owlit's words`, onSelect: () => void editThread(thread.id, { op: "revert", item }) }] : []),
          ],
          [{ label: t`Remove`, destructive: true, onSelect: () => void removeItem(thread.id, item, t`Sentence removed`) }],
        ]
        return (
          <li key={s.id} className="group/row relative -mx-2 flex gap-2.5 rounded-md px-2 hover:bg-muted/60 has-data-[state=open]:bg-muted/60">
            <span className="flex h-[1.625em] w-2 shrink-0 items-center justify-center">
              {fresh ? <NoteDot /> : <span className="size-1 rounded-full bg-muted-foreground" />}
            </span>
            {editing === s.id ? (
              <div className="min-w-0 flex-1 py-1">
                <SentenceEditor
                  value={plainMemo(s.text).plain}
                  onCancel={() => setEditing(null)}
                  onSave={(text) => {
                    setEditing(null)
                    void editThread(thread.id, { op: "rewrite", item, text: relinkMemo(text, plainMemo(s.text).links) })
                  }}
                />
              </div>
            ) : (
              <span className={cn("min-w-0 flex-1 pr-7")}>
                <MemoText text={s.text} onRow={onRow} removed={(paper) => !!thread.overrides.removed[itemId.row(paper)]} />
                {edit && (
                  <span className="ml-1.5 text-detail whitespace-nowrap text-muted-foreground" title={t`Was: ${plainMemo(edit.was).plain}`}>
                    {t({ message: "you edited", comment: "after a sentence of Owlit's that the user rewrote" })}
                  </span>
                )}
              </span>
            )}
            {editing !== s.id && <RowMenuButton groups={groups} label={t`Sentence actions`} className="absolute top-0.5 right-0.5" menuClassName="w-48" />}
          </li>
        )
      })}
    </ul>
  )
}
