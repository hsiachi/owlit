import { t } from "@lingui/core/macro"
import { itemId, type Collection } from "@owlit/protocol"
import { useState } from "react"
import { RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { NoteDot } from "@/components/marks"
import { MentionLink } from "@/components/mention/mention-token"
import { SentenceEditor } from "@/components/sentence-editor"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import { cn } from "@/lib/utils"
import { memoParts, plainMemo, relinkMemo } from "../lib"
import { editCollection, removeItem } from "../store"

// A sentence of Owlit's (or the user's rewrite of one), with the papers and groups it names as mentions
export function MemoText({ text }: { text: string }) {
  return (
    <>
      {memoParts(text).map((p, i) =>
        typeof p === "string" ? p : <MentionLink key={i} label={p.label} to={mentionRoute(p.uri)} title={mentionTitle(p.uri) ?? p.label} />,
      )}
    </>
  )
}

// Owlit's reading of the papers, a few sentences as a list. A sentence Owlit changed since the user last
// looked has the dot for its bullet; one the user rewrote says so, with Owlit's words a hover away. Each can
// be rewritten or removed from its ⋯; nothing asks to be accepted.
export function Memo({ collection, shown, seenBefore }: { collection: Collection; shown: Collection; seenBefore: number }) {
  const [editing, setEditing] = useState<string | null>(null)
  if (!shown.memo.length) return null
  return (
    <ul className="mt-4 flex max-w-[68ch] flex-col gap-1 text-body leading-relaxed">
      {shown.memo.map((s) => {
        const item = itemId.memo(s.id)
        const edit = collection.yours.edits[item]
        const fresh = (collection.changedAt[item] ?? 0) > seenBefore && !edit
        const groups: MenuGroups = [
          [
            { label: t({ message: "Rewrite", comment: "verb: change the words of Owlit's sentence" }), onSelect: () => setEditing(s.id), afterClose: true },
            ...(edit ? [{ label: t`Use Owlit's words`, onSelect: () => void editCollection(collection.id, { op: "revert", item }) }] : []),
          ],
          [{ label: t`Remove`, destructive: true, onSelect: () => void removeItem(collection.id, item, t`Sentence removed`) }],
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
                    void editCollection(collection.id, { op: "rewrite", item, text: relinkMemo(text, plainMemo(s.text).links) })
                  }}
                />
              </div>
            ) : (
              <span className={cn("min-w-0 flex-1 pr-7")}>
                <MemoText text={s.text} />
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
