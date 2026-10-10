import { useEffect, useState } from "react"
import { MessageCircleQuestionIcon, ShieldAlertIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import type { Chat, MessagePart, PermissionKind } from "../types"
import { useAskDraft } from "../ask-draft"
import { useInPlace } from "../in-place"
import { askSentence, shortUrl, type ToolCall } from "../lib/step-words"
import { pendingAsk } from "../status"
import { useChatStore } from "../store"
import { DiffPreview, diffCounts } from "./messages/step-results"

type Part<T extends MessagePart["type"]> = Extract<MessagePart, { type: T }>

// A paper's note, kept inside .owlit beside the paper
const NOTE_PATH = /^\.owlit\/papers\/[^/]+\/note\.md$/

// What the chat waits on the user for, above the composer, wherever the chat is scrolled: a permission
// (what Owlit wants to do, in its words, with a preview and owlit's buttons) or a question of the agent's
// (its choices, or an answer typed in the composer). The step in the chat only says it waits, so one
// decision has one set of buttons. Nothing shows while nothing waits.
export function WaitingDock({ chat, compact = false }: { chat: Chat; compact?: boolean }) {
  const streaming = useChatStore((s) => !!s.streaming[chat.id])
  const ask = streaming ? pendingAsk(chat) : undefined
  if (!ask) return null
  const call = chat.messages.at(-1)?.parts.find((p): p is ToolCall => p.type === "tool_call" && p.toolCallId === ask.toolCallId)
  return ask.type === "permission" ? (
    <PermissionCard key={ask.requestId} chatId={chat.id} ask={ask} call={call} compact={compact} />
  ) : (
    <QuestionCard key={ask.requestId} chatId={chat.id} ask={ask} compact={compact} />
  )
}

// The same card as the composer: card surface, its border and soft shadow, a step less roomy
const CARD = "mb-2 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-sm"

// Owlit's words for the agent's options, by what each does
const OPTION_WORDS: Record<PermissionKind, string> = {
  allow_once: "Allow",
  allow_always: "Always allow",
  reject_once: "Don't allow",
  reject_always: "Never allow",
}
const ORDER: PermissionKind[] = ["allow_once", "allow_always", "reject_once", "reject_always"]

function PermissionCard({ chatId, ask, call, compact }: { chatId: string; ask: Part<"permission">; call?: ToolCall; compact: boolean }) {
  const editPath = call?.diff?.path
  const inPlace = useInPlace((s) => !!editPath && !!s.shown[editPath])
  const [answerHere, setAnswerHere] = useState(false)
  const [all, setAll] = useState(false)
  const respond = (optionId: string) => useChatStore.getState().respondPermission(chatId, ask.requestId, optionId)

  // An edit already drawn where it would land is answered there, with Apply and Discard
  if (inPlace && !answerHere) {
    const where = editPath && NOTE_PATH.test(editPath) ? "your note" : "the doc"
    return (
      <div className={cn(CARD, "flex items-center gap-2 py-2 text-muted-foreground")}>
        <ShieldAlertIcon className="size-4 shrink-0 text-warning" />
        <span className="min-w-0 truncate">Waiting in {where}: Apply or Discard it there</span>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => setAnswerHere(true)} className="shrink-0 rounded-md px-1 py-0.5 text-foreground outline-none hover:bg-muted focus-key:bg-muted">
          Answer here
        </button>
      </div>
    )
  }

  const diff = call?.diff
  const command = call?.tool?.command ?? (call && !call.tool && call.kind === "execute" ? call.title : undefined)
  const url = call?.tool?.url
  const folder = diff?.path.includes("/") ? diff.path.split("/").slice(0, -1).join("/") : undefined
  let summary: string | undefined
  if (diff) {
    const { added, removed } = diffCounts(diff.oldText, diff.newText)
    const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`
    summary = [!diff.oldText ? "A new file" : added && `Adds ${lines(added)}`, diff.oldText && removed && `removes ${lines(removed)}`, folder && `in ${folder}`].filter(Boolean).join(" · ")
  } else if (call?.tool?.description) summary = call.tool.description

  const options = [...ask.options].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  return (
    <div className={CARD} role="group" aria-label="Owlit is waiting on you">
      <div className="flex items-start gap-2.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{askSentence(ask.title, call)}</div>
          {summary && <div className="mt-0.5 text-[13px] text-muted-foreground">{summary}</div>}
        </div>
      </div>
      {(diff || command || url) && (
        <div className={cn("relative mt-2.5 ml-6.5 overflow-hidden rounded-lg border px-3 py-2.5", all ? "max-h-72 overflow-y-auto" : "max-h-36")}>
          {diff ? (
            <DiffPreview oldText={diff.oldText} newText={diff.newText} />
          ) : command ? (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{command}</pre>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="text-[13px] text-mention hover:underline">
              {shortUrl(url!)}
            </a>
          )}
          {!all && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
        </div>
      )}
      <div className="mt-3 ml-6.5 flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
          <Button key={o.optionId} size="sm" variant={o.kind === "allow_once" ? "default" : o.kind.startsWith("allow") ? "outline" : "ghost"} onClick={() => respond(o.optionId)}>
            {OPTION_WORDS[o.kind] ?? o.name}
          </Button>
        ))}
        {(diff || command) && (
          <button type="button" onClick={() => setAll((a) => !a)} className="rounded-md px-1.5 py-1 text-[13px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
            {all ? "Show less" : "Show all"}
          </button>
        )}
        {!compact && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">Or type below to say what to do instead</span>}
      </div>
    </div>
  )
}

const editable = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

function QuestionCard({ chatId, ask, compact }: { chatId: string; ask: Part<"question">; compact: boolean }) {
  const draft = useAskDraft((s) => (s.drafts[chatId]?.requestId === ask.requestId ? s.drafts[chatId] : undefined))
  const index = draft?.index ?? 0
  const q = ask.questions[index]
  const picks = (q && draft?.answers[q.id]?.picks) ?? []
  const pick = (label: string) => useAskDraft.getState().pick(chatId, ask, label)

  // A number picks that option, unless the user is typing somewhere
  useEffect(() => {
    if (!q?.options.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || editable(document.activeElement)) return
      const n = Number(e.key)
      const option = Number.isInteger(n) && n >= 1 ? q.options[n - 1] : undefined
      if (!option) return
      e.preventDefault()
      pick(option.label)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!q) return null
  return (
    <div className={CARD} role="group" aria-label="Owlit asks you">
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{q.header && q.header !== q.question ? `Owlit asks · ${q.header}` : "Owlit asks"}</div>
          <div className="mt-0.5 text-[15px] font-medium break-words">{q.question}</div>
        </div>
        {ask.questions.length > 1 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {index + 1} of {ask.questions.length}
          </span>
        )}
      </div>
      {q.options.length > 0 && (
        <div className="mt-2.5 ml-6.5 overflow-hidden rounded-lg border">
          {q.options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              title={i < 9 ? `Press ${i + 1}` : undefined}
              aria-pressed={q.multiSelect ? picks.includes(o.label) : undefined}
              onClick={() => pick(o.label)}
              className={cn(
                "flex w-full items-baseline gap-2.5 border-t px-3 py-2 text-left outline-none first:border-t-0 hover:bg-muted focus-key:bg-muted",
                picks.includes(o.label) && "bg-muted",
              )}
            >
              <span className="w-3 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <span className={cn(picks.includes(o.label) && "font-medium")}>{o.label}</span>
                {o.description && <span className="ml-2 text-[13px] text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2.5 ml-6.5 flex items-center gap-1.5">
        {q.multiSelect && (
          <Button size="sm" disabled={!picks.length} onClick={() => useAskDraft.getState().next(chatId, ask)}>
            {index + 1 < ask.questions.length ? "Next" : "Done"}
          </Button>
        )}
        <button type="button" onClick={() => useAskDraft.getState().skip(chatId, ask)} className="rounded-md px-1.5 py-1 text-[13px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
          Skip
        </button>
        {!compact && q.allowsText && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{q.options.length ? "Or type your own answer below" : "Type your answer below"}</span>}
      </div>
    </div>
  )
}
