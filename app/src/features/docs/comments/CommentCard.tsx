import { plural, t } from "@lingui/core/macro"
import { CheckIcon, ChevronRightIcon, EllipsisIcon, LinkIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { keysFor } from "@/app/shortcuts"
import { FoldButton } from "@/components/fold"
import { IconButton } from "@/components/icon-button"
import { OwlitMark } from "@/components/owlit-mark"
import { Tip } from "@/components/tip"
import { ago } from "@/lib/time"
import { shorten } from "@/lib/words"
import { cn } from "@/lib/utils"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { openRun, useOpenRuns } from "@/features/runs/hooks"
import { fileAt } from "../store"
import { useDocsUiStore } from "../ui-store"
import { mentionLabel } from "../lib/mentions"
import { askedChat, type CommentView, type EntryView } from "./model"

// A comment's card in the column beside the doc. Closed, it is a few quiet lines: who started it, the
// start of what they said, how many replies. Open, it is a raised card, laid out the way Google Docs and
// Feishu lay theirs out: the first row is the first entry's author and the actions on the whole comment
// (Ask Owlit, Resolve); each entry of yours has its own ⋯ (Edit, Delete); replies are flat, and the field to
// add one is always at the bottom. A long thread opens with its middle folded, as in Google Docs.

// A bare owlit:// address an agent left in its words reads under its short name, never as the raw text
const BARE_URI = /(?<!\]\()owlit:\/\/[^\s)）\]]+/g
const withLabels = (text: string) =>
  text.replace(BARE_URI, (uri) => {
    const label = mentionLabel(uri)
    return label ? `[${label.replace(/[[\]]/g, "")}](${uri})` : uri
  })

// The words alone, for the closed card's few lines: links by their labels, no emphasis marks
const plainText = (text: string) =>
  withLabels(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/[*_`]+/g, "")

function Signed({ entry, className }: { entry: EntryView; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-xs text-muted-foreground", className)}>
      {/* In ink whoever wrote it: green is Owlit's hand on your words, and a comment changes none */}
      <span className="font-medium text-foreground">{entry.name}</span>
      {" · "}
      {ago(entry.at)}
      {entry.editedAt ? ` · ${t({ message: "edited", comment: "after a comment's time: it was changed after it was written" })}` : ""}
    </span>
  )
}

// A point carried over from a record of what people said (Go through): under the first entry's signature,
// one muted line saying where it came from, the record's name (without its "· reading" ending) opening it,
// and that Owlit placed it. Never a speaker's name: the words say who said what.
function SourceLine({ view, className }: { view: CommentView; className?: string }) {
  const navigate = useNavigate()
  const source = view.doc?.source
  if (!source) return null
  const name = source.label.replace(/ · (reading|解读)( \d+)?$/, "")
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {t({ message: "From", comment: "before the name of the record a comment's point was carried over from: From P5 周会 · placed by Owlit" })}{" "}
      <button
        type="button"
        className="font-medium text-foreground hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          const file = fileAt(source.path)
          if (file) navigate(`/docs/${file.id}`)
        }}
      >
        {name}
      </button>
      {" · "}
      {t({ message: "placed by Owlit", comment: "after the record's name on a comment Owlit carried over from it" })}
    </p>
  )
}

export function ClosedCard({ view, lost, onOpen, onHover }: { view: CommentView; lost: boolean; onOpen: () => void; onHover: (on: boolean) => void }) {
  const first = view.entries[0]
  const last = view.entries[view.entries.length - 1]
  const replies = view.entries.length - 1
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        onOpen()
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="group relative w-full cursor-default rounded-lg py-1.5 pr-2.5 pl-4 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
    >
      {/* The comment colour, as on its words */}
      <span aria-hidden className="absolute top-2.5 bottom-2.5 left-1.5 w-0.5 rounded-full bg-comment-mark" />
      <div className="flex">
        <Signed entry={first} />
      </div>
      <SourceLine view={view} />
      {lost && <p className="text-xs text-muted-foreground">{t`Its passage has changed`}</p>}
      <p className="mt-0.5 line-clamp-3 text-detail leading-snug text-muted-foreground">{plainText(first.text)}</p>
      {/* Who answered last, so a reply that came while you were away shows without opening the card */}
      {replies > 0 && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {plural(replies, { one: "# reply", other: "# replies" })}
          {" · "}
          {t({ message: `${last.name} replied ${ago(last.at, { inSentence: true })}`, comment: "after a comment's reply count: who wrote the latest reply, and when" })}
        </p>
      )}
    </div>
  )
}

interface OpenActions {
  onAsk: () => void
  onResolve: () => void
  // Owlit's comments in the user's own docs only
  onDismiss?: () => void
  onReply: (text: string) => Promise<void> | void
  onEdit: (entryId: string, text: string) => void
  onDelete: (entryId: string) => void
  onClose: () => void
}

// Owlit answering the user's reply: its words shimmer where its entry will be, and open the run
const REPLY_RUN = ["docs.reply"]
function Replying({ subject }: { subject: string }) {
  const [run] = useOpenRuns(subject, REPLY_RUN)
  if (!run) return null
  return (
    <div className="mt-3">
      <div className="flex h-6 items-center text-xs font-medium">Owlit</div>
      <button type="button" disabled={!run.chatId} onClick={() => run.chatId && void openRun(run.chatId)} className="shimmer text-left text-sm text-muted-foreground">
        {t({ message: "Replying…", comment: "Owlit is writing its answer to the user's reply on a comment" })}
      </button>
    </div>
  )
}

// replyRun: the subject of Owlit's run answering a reply here ("<path>#<comment id>"), for Owlit's comments
export function OpenCard({ view, lost, actions, focusReply, replyRun }: { view: CommentView; lost: boolean; actions: OpenActions; focusReply?: boolean; replyRun?: string }) {
  const [first, ...replies] = view.entries
  const [editing, setEditing] = useState<string | null>(null)
  // More than three replies open folded down to the latest. Which one that is is fixed when the card
  // opens, so your own reply lands under it rather than pushing it into the fold.
  const [shownFrom, setShownFrom] = useState(() => (replies.length > 3 ? replies[replies.length - 1].id : null))
  const cut = shownFrom === null ? 0 : Math.max(0, replies.findIndex((e) => e.id === shownFrom))
  return (
    <div className="rounded-xl border bg-card py-2 pr-1.5 pl-3 shadow-md" onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && actions.onClose()}>
      {/* The first row: who started it, then what acts on the whole comment */}
      <div className="flex h-6 items-center gap-1">
        <Signed entry={first} className="flex-1" />
        <IconButton label={t`Ask Owlit about this comment`} size="icon-xs" onClick={actions.onAsk}>
          <OwlitMark />
        </IconButton>
        <IconButton label={t({ message: "Resolve", comment: "put a comment away" })} size="icon-xs" onClick={actions.onResolve}>
          <CheckIcon />
        </IconButton>
        {first.who === "owlit" && actions.onDismiss && (
          <IconButton label={t({ message: "Dismiss", comment: "tell Owlit its comment isn't wanted; it won't say it again" })} size="icon-xs" onClick={actions.onDismiss}>
            <XIcon />
          </IconButton>
        )}
        {first.editable && <EntryMenu entry={first} first hasReplies={replies.length > 0} onEdit={() => setEditing(first.id)} onDelete={() => actions.onDelete(first.id)} />}
      </div>
      <div className="pr-1.5">
        <SourceLine view={view} className="mt-0.5" />
        {lost && <p className="mt-0.5 text-xs text-muted-foreground">{t`The passage this comment was on has changed: “${shorten(view.quote, 90)}”`}</p>}
        <EntryText entry={first} editing={editing === first.id} onSave={(text) => {
            actions.onEdit(first.id, text)
            setEditing(null)
          }} onCancel={() => setEditing(null)} />
        {cut > 0 && (
          <FoldButton open={false} onClick={() => setShownFrom(null)} className="mt-2">
            {plural(cut, { one: "# more reply", other: "# more replies" })}
          </FoldButton>
        )}
        {replies.slice(cut).map((entry) => (
          <div key={entry.id} className="group/entry mt-3">
            <div className="-mr-1.5 flex h-6 items-center gap-0.5">
              <Signed entry={entry} className="flex-1" />
              {entry.editable && <EntryMenu entry={entry} onEdit={() => setEditing(entry.id)} onDelete={() => actions.onDelete(entry.id)} />}
            </div>
            <EntryText entry={entry} editing={editing === entry.id} onSave={(text) => {
                actions.onEdit(entry.id, text)
                setEditing(null)
              }} onCancel={() => setEditing(null)} />
          </div>
        ))}
        {replyRun && <Replying subject={replyRun} />}
        <AskedLine commentKey={view.key} />
        {/* Keyed by the comment, so another comment opened in its place starts with an empty field */}
        <ReplyField key={view.key} view={view} autoFocus={focusReply} onReply={actions.onReply} />
      </div>
    </div>
  )
}

function EntryText({ entry, editing, onSave, onCancel }: { entry: EntryView; editing: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(entry.text)
  if (!editing) return <Markdown text={withLabels(entry.text)} className="comment-text text-sm" />
  const save = () => text.trim() && onSave(text.trim())
  return (
    <div className="mt-1">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
          if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        className="min-h-8 resize-none px-2 py-1.5 text-sm md:text-sm"
      />
      <FieldButtons label={t({ message: "Save", comment: "save an edited comment" })} disabled={!text.trim()} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}

// Your own entries only: the share server keeps readers' words as they wrote them, and Owlit's are Owlit's
function EntryMenu({ first, hasReplies, onEdit, onDelete }: { entry: EntryView; first?: boolean; hasReplies?: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <Tip label={t`More`}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t`More`}
            className={cn("text-muted-foreground", !first && "opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      {/* As wide as its words: the default is the 24px ⋯ it opens from */}
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon />
          {t({ message: "Edit", comment: "edit your comment or reply" })}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          {/* As in Google Docs, the first entry is the comment: deleting it takes the replies too */}
          {first ? (hasReplies ? t`Delete comment and replies` : t`Delete comment`) : t`Delete reply`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The field's buttons: Cancel, then the one ⌘↵ presses, with the key shown on it as
// "New doc ⌘N" shows its own (Linear and GitHub label theirs the same way). Not in the placeholder, which is
// gone by the time there is something to send; the buttons only appear once there is.
function FieldButtons({ label, disabled, onCancel, onSubmit }: { label: string; disabled: boolean; onCancel: () => void; onSubmit: () => void }) {
  return (
    <div className="mt-1.5 flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">
        {t`Cancel`}
      </Button>
      <Button size="sm" disabled={disabled} onClick={onSubmit}>
        {label}
        <Kbd className="bg-transparent text-primary-foreground/60">{keysFor("save-comment")}</Kbd>
      </Button>
    </div>
  )
}

// Where the comment was asked about, once it was: the chat with Owlit's answer, opened beside the doc
function AskedLine({ commentKey }: { commentKey: string }) {
  const asked = useDocsUiStore((s) => s.askedChats[commentKey])
  const title = useChatStore((s) => (asked ? s.chats[asked.chatId]?.title : undefined))
  if (!asked || title === undefined || !askedChat(commentKey)) return null
  return (
    <Tip label={t`Open the chat beside the doc`}>
      <button
        type="button"
        onClick={() => useAgentWindow.getState().showChat(asked.chatId)}
        className="mt-2 -ml-1 flex h-6 max-w-full items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0"
      >
        <OwlitMark />
        <span className="truncate">
          {title
            ? t({ message: `Asked Owlit ${ago(asked.at, { inSentence: true })} in “${title}”`, comment: "on a comment's card: when it was asked about in a chat, and the chat's title" })
            : t({ message: `Asked Owlit ${ago(asked.at, { inSentence: true })}`, comment: "on a comment's card: when it was asked about in a chat" })}
        </span>
        <ChevronRightIcon />
      </button>
    </Tip>
  )
}

// The reply field, always at the bottom: it adds to the whole comment. Who hears it is said once there is
// something to send.
function ReplyField({ view, autoFocus, onReply }: { view: CommentView; autoFocus?: boolean; onReply: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const send = async () => {
    const said = text.trim()
    if (!said || sending) return
    setSending(true)
    try {
      await onReply(said)
      setText("")
    } catch {
      // The error was shown; what was typed stays
    } finally {
      setSending(false)
    }
  }
  const startedBy = view.entries[0]
  const hint = view.thread
    ? { icon: <LinkIcon />, text: t`${startedBy.name} sees replies on the shared page.` }
    : startedBy.who === "owlit"
      ? // Owlit answers under its own comments, as a run with a body (the card's replying line); an edit
        // to the doc is asked for in a chat, from the feather
        { icon: <OwlitMark />, text: t`Owlit answers here. To have it change the doc, use the feather above.` }
      : null
  return (
    <div className="mt-3 mb-0.5">
      <Textarea
        rows={1}
        autoFocus={autoFocus}
        value={text}
        placeholder={t`Reply…`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
          if (e.key === "Escape" && text) {
            e.preventDefault()
            setText("")
          }
        }}
        className="min-h-8 resize-none px-2.5 py-1.5 text-sm md:text-sm"
      />
      {text && (
        <>
          {hint && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-3 [&_svg]:shrink-0">{hint.icon}{hint.text}</p>}
          <FieldButtons label={t({ message: "Reply", comment: "send a reply to a comment" })} disabled={sending} onCancel={() => setText("")} onSubmit={() => void send()} />
        </>
      )}
    </div>
  )
}

// The comment being started on selected words: a card with the field ready
export function NewCard({ onSave, onCancel }: { onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("")
  const save = () => text.trim() && onSave(text.trim())
  return (
    <div className="rounded-xl border bg-card py-2 pr-3 pl-3 shadow-md">
      <div className="flex h-6 items-center text-xs font-medium">{t({ message: "You", comment: "who wrote a comment or reply: the user" })}</div>
      <Textarea
        autoFocus
        rows={2}
        value={text}
        placeholder={t`Comment…`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
          if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        className="mt-1 min-h-14 resize-none px-2.5 py-1.5 text-sm md:text-sm"
      />
      <FieldButtons label={t({ message: "Comment", context: "verb: say something about the selected words" })} disabled={!text.trim()} onCancel={onCancel} onSubmit={save} />
    </div>
  )
}
