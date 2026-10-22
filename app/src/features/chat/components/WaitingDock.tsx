import { plural, t } from "@lingui/core/macro"
import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { FadeClip, ShowAllButton } from "@/components/fade-clip"
import { FoldChevron } from "@/components/fold"
import { IconButton } from "@/components/icon-button"
import { useWindowKeydown } from "@/hooks/use-window-keydown"
import { type AgentQuestion, type Chat, editStats, parentPath, type PermissionKind } from "@owlit/protocol"
import { isTyping } from "@/lib/keys"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Unfold } from "@/components/unfold"
import type { Part, ToolCall } from "../types"
import { allAnswered, answered, nextOpen, useAskDraft } from "../ask-draft"
import { amount } from "../lib/edit-counts"
import { askSentence, runsCommand, shortUrl } from "../lib/step-words"
import { callOf, pendingAsk } from "../status"
import { useChatStore } from "../store"
import { DiffPreview } from "./messages/step-results"

// What the chat waits on the user for, above the composer, wherever the chat is scrolled: a permission
// (what Owlit wants to do, in its words, with a preview and owlit's buttons) or a question of the agent's
// (its choices, or an answer typed in the composer). The step in the chat only says it waits, so one
// decision has one set of buttons. Nothing shows while nothing waits.
// The card is seen arriving (the slot grows while it rises into place) and leaving once answered, rather than
// found already there.
// `onTypeInstead` puts the keyboard in the composer, for an answer in the user's own words.
export function WaitingDock({ chat, compact = false, onTypeInstead }: { chat: Chat; compact?: boolean; onTypeInstead?: () => void }) {
  const streaming = useChatStore((s) => !!s.streaming[chat.id])
  const ask = streaming ? pendingAsk(chat) : undefined
  const call = ask ? callOf(chat, ask.toolCallId) : undefined
  // Asked by one of the agent's own agents: the card says which, so it is found among several at work
  const agent = ask?.agentId ? chat.messages.at(-1)?.parts.find((p): p is Part<"agent"> => p.type === "agent" && p.agentId === ask.agentId)?.title : undefined
  return (
    <Unfold open={!!ask} rise>
      {ask &&
        (ask.type === "permission" ? (
          <PermissionCard key={ask.requestId} chatId={chat.id} ask={ask} call={call} agent={agent} compact={compact} />
        ) : (
          <QuestionCard key={ask.requestId} chatId={chat.id} ask={ask} agent={agent} compact={compact} onTypeInstead={onTypeInstead} />
        ))}
    </Unfold>
  )
}

// The same card as the composer: card surface, its border and soft shadow, a step less roomy
const CARD = "mb-2 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-sm"

// Owlit's words for the agent's options, by what each does
const optionWords = (kind: PermissionKind): string | undefined =>
  ({
    allow_once: t`Allow`,
    allow_always: t`Always allow`,
    reject_once: t`Don't allow`,
    reject_always: t`Never allow`,
  })[kind]
const ORDER: PermissionKind[] = ["allow_once", "allow_always", "reject_once", "reject_always"]

function PermissionCard({ chatId, ask, call, agent, compact }: { chatId: string; ask: Part<"permission">; call?: ToolCall; agent?: string; compact: boolean }) {
  const [all, setAll] = useState(false)
  const [long, setLong] = useState(false)
  const respond = (optionId: string) => useChatStore.getState().respondPermission(chatId, ask.requestId, optionId)

  const diff = call?.diff
  const command = call?.tool?.command ?? (call && runsCommand(call) ? call.title : undefined)
  const url = call?.tool?.url
  const folder = diff ? parentPath(diff.path) || undefined : undefined
  let summary: string | undefined
  if (diff) {
    const stats = editStats(diff.path, diff.oldText, diff.newText)
    // A Write carries the whole file, so only it can tell that most of the doc would go
    const added = amount(stats.added, stats.unit)
    const removed = amount(stats.removed, stats.unit)
    const said = !diff.oldText
      ? [t`A new file`]
      : call?.tool?.name === "Write" && stats.rewritten
        ? [t`Rewrites the doc`]
        : [stats.added && t`Adds ${added}`, stats.removed && (stats.added ? t({ message: `removes ${removed}`, comment: "after “Adds …”, hence lowercase" }) : t`Removes ${removed}`)]
    summary = [...said, folder && t`in ${folder}`].filter(Boolean).join(" · ")
  } else if (call?.tool?.description) summary = call.tool.description
  if (agent) summary = [t`For the agent “${agent}”`, summary].filter(Boolean).join(" · ")

  const options = [...ask.options].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  // The words say what waits ("Owlit wants to edit story.md"); no mark leads them
  return (
    <div className={CARD} role="group" aria-label={t`Owlit is waiting on you`}>
      <div className="min-w-0">
        <div className="font-medium break-words">{askSentence(ask.title, call)}</div>
        {summary && <div className="mt-0.5 text-detail text-muted-foreground">{summary}</div>}
      </div>
      {(diff || command || url) && (
        <FadeClip open={all} long={long} onLong={setLong} max="max-h-36" openMax="max-h-72 overflow-y-auto" surface="card" className="mt-2.5 rounded-lg border px-3 py-2.5">
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
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
          <Button key={o.optionId} size="sm" variant={o.kind === "allow_once" ? "default" : o.kind.startsWith("allow") ? "outline" : "ghost"} onClick={() => respond(o.optionId)}>
            {optionWords(o.kind) ?? o.name}
          </Button>
        ))}
        {(diff || command) && long && <ShowAllButton open={all} onClick={() => setAll((a) => !a)} className="ml-0 h-7" />}
        {!compact && <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{t`Or type below what to do instead; it sends when Owlit finishes`}</span>}
      </div>
    </div>
  )
}

// A question's choices: a radio (one pick) or a checkbox (several) before the label, its description under
// it, the key that picks it at the end; and, when words of one's own are taken, a last row that hands over
// to the composer. Plain rows, no frame (a card inside the card would stack outlines): the `muted` fill on
// hover, keyboard focus and once picked is all that draws them. Each row is a label around its control, so
// the row is the hit area and the control keeps its own keyboard focus.
// A choice is a block on the `muted` fill, so the choices read as things to pick rather than lines of text;
// the picked one is lifted onto `card` with a hairline border, as a chosen segment is. Hover and keyboard
// focus take the `accent` step.
const OPTION_ROW = "group/option flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-transparent bg-muted px-3 py-2 text-left hover:bg-accent has-focus-visible:bg-accent"
const OPTION_PICKED = "border-border bg-card shadow-xs hover:bg-card"

function Radio({ checked, onPick, className }: { checked: boolean; onPick: () => void; className?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-key:border-ring focus-key:ring-3 focus-key:ring-ring/50 dark:bg-input/30",
        checked && "border-primary bg-primary text-primary-foreground",
        className,
      )}
    >
      {checked && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
    </button>
  )
}

function QuestionCard({ chatId, ask, agent, compact, onTypeInstead }: { chatId: string; ask: Part<"question">; agent?: string; compact: boolean; onTypeInstead?: () => void }) {
  const draft = useAskDraft((s) => (s.drafts[chatId]?.requestId === ask.requestId ? s.drafts[chatId] : undefined))
  const index = draft?.index ?? 0
  const answers = draft?.answers ?? {}
  const folded = draft?.folded ?? false
  const q = ask.questions[index]
  const picks = (q && answers[q.id]?.picks) ?? []
  const several = ask.questions.length > 1
  const store = useAskDraft.getState
  const pick = (label: string) => store().pick(chatId, ask, label)
  const fold = (to: boolean) => store().fold(chatId, ask, to)
  const headerOf = (question: AgentQuestion, i: number) => {
    const number = i + 1
    return question.header || t`Question ${number}`
  }

  // A number picks that option, unless the user is typing somewhere
  useWindowKeydown((e) => {
    if (!q || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return
    const n = Number(e.key)
    const option = Number.isInteger(n) && n >= 1 ? q.options[n - 1] : undefined
    if (!option) return
    e.preventDefault()
    pick(option.label)
  }, !folded && !!q?.options.length)

  if (!q) return null
  const done = allAnswered(ask, answers)
  const here = answered(q, answers)
  // Next while a later question is still open; Submit on the last question or once every question is answered
  const later = nextOpen(ask, answers, index)
  const submits = done || later === undefined
  const asks = agent ? t`Owlit asks for the agent “${agent}”` : t`Owlit asks`
  // "Owlit asks · Venue": the question's header after the words, falling back to its number among several
  const header = several ? headerOf(q, index) : q.header && q.header !== q.question ? q.header : undefined
  const asksAbout = (header: string) => (agent ? t`Owlit asks for the agent “${agent}” · ${header}` : t`Owlit asks · ${header}`)
  const count = ask.questions.length
  const foldedLine = several
    ? agent
      ? plural(count, { one: `Owlit asks for the agent “${agent}” # question`, other: `Owlit asks for the agent “${agent}” # questions` })
      : plural(count, { one: "Owlit asks # question", other: "Owlit asks # questions" })
    : header
      ? asksAbout(header)
      : agent
        ? t`Owlit asks for the agent “${agent}” a question`
        : t`Owlit asks a question`
  const goTo = (i: number) => store().goTo(chatId, ask, i)
  return (
    <div className={CARD} role="group" aria-label={t`Owlit asks you`}>
      {/* The header line folds the card to itself and opens it again; the pager and the chevron are the buttons */}
      <div className="flex min-h-6 cursor-default items-center gap-2.5" onClick={() => fold(!folded)}>
        <span className={cn("min-w-0 flex-1 truncate text-muted-foreground", folded ? "text-sm" : "text-xs")}>{folded ? foldedLine : header ? asksAbout(header) : asks}</span>
        {/* Several questions: a pager at the line's end, so an answered one can be gone back to */}
        {!folded && several && (
          <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <IconButton label={t`Previous question`} size="icon-xs" disabled={index === 0} onClick={() => goTo(index - 1)}>
              <ChevronLeftIcon />
            </IconButton>
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {index + 1} / {ask.questions.length}
            </span>
            <IconButton label={t`Next question`} size="icon-xs" disabled={index === ask.questions.length - 1} onClick={() => goTo(index + 1)}>
              <ChevronRightIcon />
            </IconButton>
          </span>
        )}
        {folded ? (
          <Button variant="text" size="inline" className="shrink-0" onClick={(e) => (e.stopPropagation(), fold(false))}>
            {t({ message: "Show", comment: "verb: unfold the card with Owlit's question" })}
          </Button>
        ) : (
          <Button variant="ghost" size="icon-xs" aria-expanded aria-label={t({ message: "Fold", comment: "verb: fold the card to one line" })} className="-mr-1 shrink-0 text-muted-foreground" onClick={(e) => (e.stopPropagation(), fold(true))}>
            <FoldChevron open />
          </Button>
        )}
      </div>
      <Unfold open={!folded}>
        <div className="pt-0.5">
          <div className="text-body font-medium break-words">{q.question}</div>
          {(q.options.length > 0 || q.allowsText) && (
            <div className="mt-2.5 flex flex-col gap-1" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
              {q.options.map((o, i) => {
                const picked = picks.includes(o.label)
                return (
                  <label key={o.label} className={cn(OPTION_ROW, picked && OPTION_PICKED)}>
                    {q.multiSelect ? (
                      <Checkbox checked={picked} onCheckedChange={() => pick(o.label)} aria-label={o.label} className="mt-0.5" />
                    ) : (
                      <Radio checked={picked} onPick={() => pick(o.label)} className="mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", picked && "font-medium")}>{o.label}</span>
                      {o.description && <span className="block text-detail text-muted-foreground">{o.description}</span>}
                    </span>
                    {i < 9 && (
                      <Kbd aria-hidden className="mt-px bg-transparent">
                        {i + 1}
                      </Kbd>
                    )}
                  </label>
                )
              })}
              {q.allowsText && (
                <button type="button" onClick={onTypeInstead} className={cn(OPTION_ROW, "items-center text-sm text-muted-foreground outline-none focus-key:bg-muted")}>
                  {q.options.length > 0 && <span aria-hidden className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1">{t`Something else…`}</span>
                </button>
              )}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-1.5">
            {!compact && q.allowsText && <span className="min-w-0 truncate text-xs text-muted-foreground">{q.options.length ? t`Or type your own answer below` : t`Type your answer below`}</span>}
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => store().skip(chatId, ask)}>
              {t({ message: "Skip", comment: "verb: skip the agent's question" })}
            </Button>
            <Button size="sm" disabled={submits ? !done : !here} onClick={() => (submits ? store().submit(chatId, ask) : store().next(chatId, ask))}>
              {submits ? t`Submit` : t({ message: "Next", comment: "button: the next question" })}
            </Button>
          </div>
        </div>
      </Unfold>
    </div>
  )
}
