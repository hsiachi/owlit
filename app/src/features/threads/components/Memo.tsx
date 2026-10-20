import { itemId, parseOwlitUri, type ThreadRead } from "@owlit/protocol"
import { NoteDot } from "@/components/marks"
import { MentionToken } from "@/components/mention/mention-token"
import { useNavigate } from "react-router-dom"
import { mentionRoute, mentionTitle, usePaperUnread } from "@/features/docs/lib/mentions"
import { memoOf, memoParts } from "../lib"

// A sentence of Owlit's, with the papers and groups it names as mentions. A paper that is a row of the
// thread opens that row in place (onRow); others go where they live.
export function MemoText({ text, onRow }: { text: string; onRow?: (paperId: string) => boolean }) {
  return (
    <>
      {memoParts(text).map((p, i) => (typeof p === "string" ? p : <MemoMention key={i} label={p.label} uri={p.uri} onRow={onRow} />))}
    </>
  )
}

// A paper not read yet is lighter until it is, as in docs and chat
function MemoMention({ label, uri, onRow }: { label: string; uri: string; onRow?: (paperId: string) => boolean }) {
  const navigate = useNavigate()
  const unread = usePaperUnread(uri)
  const u = parseOwlitUri(uri)
  const route = mentionRoute(uri)
  const open = u?.kind === "paper" && onRow ? () => onRow(u.id) || (route && navigate(route)) : route ? () => navigate(route) : undefined
  return <MentionToken label={label} title={mentionTitle(uri) ?? label} unread={unread} onClick={open} />
}

// The report's first paragraph, its sentences as a list. Changed since the user last looked, each has the
// dot for its bullet.
export function Memo({ thread, fresh: isFresh, onRow }: { thread: ThreadRead; fresh: (item: string) => boolean; onRow?: (paperId: string) => boolean }) {
  const memo = memoOf(thread)
  if (!memo.length) return null
  const fresh = isFresh(itemId.report())
  return (
    <ul className="mt-4 flex max-w-[68ch] flex-col gap-1 text-body leading-relaxed">
      {memo.map((s) => (
        <li key={s.id} className="relative -mx-2 flex gap-2.5 rounded-md px-2">
          <span className="flex h-[1.625em] w-2 shrink-0 items-center justify-center">{fresh ? <NoteDot /> : <span className="size-1 rounded-full bg-muted-foreground" />}</span>
          <span className="min-w-0 flex-1 pr-7">
            <MemoText text={s.text} onRow={onRow} />
          </span>
        </li>
      ))}
    </ul>
  )
}
