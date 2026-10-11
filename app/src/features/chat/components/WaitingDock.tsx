import { useState } from "react"
import { MessageCircleQuestionIcon } from "lucide-react"
import { BorderedList } from "@/components/bordered-list"
import { FadeClip, ShowAllButton } from "@/components/fade-clip"
import { WaitingShield } from "@/components/marks"
import { useWindowKeydown } from "@/hooks/use-window-keydown"
import { editStats, parentPath } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Chat, Part, PermissionKind } from "../types"
import { useAskDraft } from "../ask-draft"
import { useInPlace } from "../in-place"
import { paperOfNotePath } from "@/features/library/notes/note-actions"
import { amount } from "../lib/edit-counts"
import { askSentence, runsCommand, shortUrl, type ToolCall } from "../lib/step-words"
import { callOf, pendingAsk } from "../status"
import { useChatStore } from "../store"
import { DiffPreview } from "./messages/step-results"

// What the chat waits on the user for, above the composer, wherever the chat is scrolled: a permission
// (what Owlit wants to do, in its words, with a preview and owlit's buttons) or a question of the agent's
// (its choices, or an answer typed in the composer). The step in the chat only says it waits, so one
// decision has one set of buttons. Nothing shows while nothing waits.
export function WaitingDock({ chat, compact = false }: { chat: Chat; compact?: boolean }) {
  const streaming = useChatStore((s) => !!s.streaming[chat.id])
  const ask = streaming ? pendingAsk(chat) : undefined
  if (!ask) return null
  const call = callOf(chat, ask.toolCallId)
  // Asked by one of the agent's own agents: the card says which, so it is found among several at work
  const agent = ask.agentId ? chat.messages.at(-1)?.parts.find((p): p is Part<"agent"> => p.type === "agent" && p.agentId === ask.agentId)?.title : undefined
  return ask.type === "permission" ? (
    <PermissionCard key={ask.requestId} chatId={chat.id} ask={ask} call={call} agent={agent} compact={compact} />
  ) : (
    <QuestionCard key={ask.requestId} chatId={chat.id} ask={ask} agent={agent} compact={compact} />
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

function PermissionCard({ chatId, ask, call, agent, compact }: { chatId: string; ask: Part<"permission">; call?: ToolCall; agent?: string; compact: boolean }) {
  const editPath = call?.diff?.path
  const inPlace = useInPlace((s) => !!editPath && !!s.shown[editPath])
  const [answerHere, setAnswerHere] = useState(false)
  const [all, setAll] = useState(false)
  const [long, setLong] = useState(false)
  const respond = (optionId: string) => useChatStore.getState().respondPermission(chatId, ask.requestId, optionId)

  // An edit already drawn where it would land is answered there, with Apply and Discard
  if (inPlace && !answerHere) {
    const where = editPath && paperOfNotePath(editPath) ? "your note" : "the doc"
    return (
      <div className={cn(CARD, "flex items-center gap-2 py-2 text-muted-foreground")}>
        <WaitingShield size="md" />
        <span className="min-w-0 truncate">Waiting in {where}: Apply or Discard it there</span>
        <span aria-hidden>·</span>
        <Button variant="text" size="inline" onClick={() => setAnswerHere(true)}>
          Answer here
        </Button>
      </div>
    )
  }

  const diff = call?.diff
  const command = call?.tool?.command ?? (call && runsCommand(call) ? call.title : undefined)
  const url = call?.tool?.url
  const folder = diff ? parentPath(diff.path) || undefined : undefined
  let summary: string | undefined
  if (diff) {
    const stats = editStats(diff.path, diff.oldText, diff.newText)
    // A Write carries the whole file, so only it can tell that most of the doc would go
    const said = !diff.oldText
      ? ["A new file"]
      : call?.tool?.name === "Write" && stats.rewritten
        ? ["Rewrites the doc"]
        : [stats.added && `Adds ${amount(stats.added, stats.unit)}`, stats.removed && `removes ${amount(stats.removed, stats.unit)}`]
    summary = [...said, folder && `in ${folder}`].filter(Boolean).join(" · ")
  } else if (call?.tool?.description) summary = call.tool.description
  if (agent) summary = [`For the agent “${agent}”`, summary].filter(Boolean).join(" · ")

  const options = [...ask.options].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  return (
    <div className={CARD} role="group" aria-label="Owlit is waiting on you">
      <div className="flex items-start gap-2.5">
        <WaitingShield size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{askSentence(ask.title, call)}</div>
          {summary && <div className="mt-0.5 text-detail text-muted-foreground">{summary}</div>}
        </div>
      </div>
      {(diff || command || url) && (
        <FadeClip open={all} long={long} onLong={setLong} max="max-h-36" openMax="max-h-72 overflow-y-auto" surface="card" className="mt-2.5 ml-6.5 rounded-lg border px-3 py-2.5">
          {diff ? (
            <DiffPreview oldText={diff.oldText} newText={diff.newText} />
          ) : command ? (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{command}</pre>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="text-detail text-mention hover:underline">
              {shortUrl(url!)}
            </a>
          )}
        </FadeClip>
      )}
      <div className="mt-3 ml-6.5 flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
          <Button key={o.optionId} size="sm" variant={o.kind === "allow_once" ? "default" : o.kind.startsWith("allow") ? "outline" : "ghost"} onClick={() => respond(o.optionId)}>
            {OPTION_WORDS[o.kind] ?? o.name}
          </Button>
        ))}
        {(diff || command) && long && <ShowAllButton open={all} onClick={() => setAll((a) => !a)} />}
        {!compact && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">Or type below to say what to do instead</span>}
      </div>
    </div>
  )
}

const editable = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

function QuestionCard({ chatId, ask, agent, compact }: { chatId: string; ask: Part<"question">; agent?: string; compact: boolean }) {
  const draft = useAskDraft((s) => (s.drafts[chatId]?.requestId === ask.requestId ? s.drafts[chatId] : undefined))
  const index = draft?.index ?? 0
  const q = ask.questions[index]
  const picks = (q && draft?.answers[q.id]?.picks) ?? []
  const pick = (label: string) => useAskDraft.getState().pick(chatId, ask, label)

  // A number picks that option, unless the user is typing somewhere
  useWindowKeydown((e) => {
    if (!q || e.metaKey || e.ctrlKey || e.altKey || editable(document.activeElement)) return
    const n = Number(e.key)
    const option = Number.isInteger(n) && n >= 1 ? q.options[n - 1] : undefined
    if (!option) return
    e.preventDefault()
    pick(option.label)
  }, !!q?.options.length)

  if (!q) return null
  return (
    <div className={CARD} role="group" aria-label="Owlit asks you">
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            {[agent ? `Owlit asks for the agent “${agent}”` : "Owlit asks", q.header && q.header !== q.question ? q.header : undefined].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-0.5 text-body font-medium break-words">{q.question}</div>
        </div>
        {ask.questions.length > 1 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {index + 1} of {ask.questions.length}
          </span>
        )}
      </div>
      {q.options.length > 0 && (
        <BorderedList className="mt-2.5 ml-6.5">
          {q.options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              title={i < 9 ? `Press ${i + 1}` : undefined}
              aria-pressed={q.multiSelect ? picks.includes(o.label) : undefined}
              onClick={() => pick(o.label)}
              className={cn(
                "flex w-full items-baseline gap-2.5 px-3 py-2 text-left outline-none hover:bg-muted focus-key:bg-muted",
                picks.includes(o.label) && "bg-muted",
              )}
            >
              <span className="w-3 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <span className={cn(picks.includes(o.label) && "font-medium")}>{o.label}</span>
                {o.description && <span className="ml-2 text-detail text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          ))}
        </BorderedList>
      )}
      <div className="mt-2.5 ml-6.5 flex items-center gap-1.5">
        {q.multiSelect && (
          <Button size="sm" disabled={!picks.length} onClick={() => useAskDraft.getState().next(chatId, ask)}>
            {index + 1 < ask.questions.length ? "Next" : "Done"}
          </Button>
        )}
        <Button variant="text" size="inline" onClick={() => useAskDraft.getState().skip(chatId, ask)}>
          Skip
        </Button>
        {!compact && q.allowsText && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{q.options.length ? "Or type your own answer below" : "Type your answer below"}</span>}
      </div>
    </div>
  )
}
