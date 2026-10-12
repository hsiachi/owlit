import { useState } from "react"
import { CheckIcon, CircleAlertIcon, CircleDotIcon, CircleIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { WaitingLabel } from "@/components/marks"
import { Spinner } from "@/components/ui/spinner"
import { Unfold } from "@/components/unfold"
import type { Part } from "../../types"
import { Markdown } from "./Markdown"
import { toolTitle } from "../../lib/tool-title"
import { blockSentence, fileName, foldable, groupPhrase, liveSentence, pathOf, stepWords, type StepWords, type ToolCall, type WordedStep } from "../../lib/step-words"
import { hasResult, stepMeta } from "../../lib/step-output"
import { StepResult } from "./step-results"
import { FoldingBlock, FoldingList, StepChevron, StepRow } from "./folding"
import { useOpenWhile } from "./use-open-while"
import { capital, plural } from "@/lib/words"

// The outcome of a permission request, keyed by the tool call it was asked for
export type PermissionOutcome = NonNullable<Part<"permission">["outcome"]>
export type PermissionOutcomes = Record<string, PermissionOutcome>

// What a step was asked about, by its tool call: the permission's outcome, the question it asked, and the
// one call waiting on the user right now
export interface StepAsks {
  outcomes: PermissionOutcomes
  questions: Record<string, Part<"question">>
  waiting?: string
}

// Owlit's words for each answer, the same whichever agent asked
const outcomeLabel: Record<PermissionOutcome, string> = {
  allow_once: "Allowed",
  allow_always: "Always allowed",
  reject_once: "Not allowed",
  reject_always: "Never allowed",
  cancelled: "Not answered",
}

const isRejection = (o?: PermissionOutcome) => !!o && !o.startsWith("allow")

export type StepPart = Part<"thought"> | Part<"tool_call">

// ---- One row ----

// Each row is one plain sentence. A row that got something opens to it; its chevron stays faintly in
// view so that is easy to find. Only a step at work, one waiting on the user and a real failure carry a
// mark; a finished step goes quiet. A step the user declined isn't a failure, so it gets no red.
function StepLine({
  words,
  live,
  open,
  onToggle,
  after,
  right,
  className,
}: {
  words: string
  live?: boolean
  open: boolean
  onToggle?: () => void
  after?: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <StepRow open={open} onToggle={onToggle} className={className}>
      <span className={cn("min-w-0", open ? "break-words" : "truncate", live && "shimmer")}>{words}</span>
      {after}
      {onToggle && <StepChevron open={open} />}
      {right && <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-xs text-muted-foreground">{right}</span>}
    </StepRow>
  )
}

const ResultBox = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 pb-3">
    <div className="max-h-60 overflow-auto rounded-md bg-muted px-2.5 py-2 text-detail">{children}</div>
  </div>
)

function ToolRow({ call, words, asks, streaming }: { call: ToolCall; words: StepWords; asks: StepAsks; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const outcome = asks.outcomes[call.toolCallId]
  const question = asks.questions[call.toolCallId]
  const waiting = asks.waiting === call.toolCallId
  // A step still going when its answer stopped won't go on: it says so instead of spinning
  const unfinished = call.status === "pending" || call.status === "in_progress"
  const running = unfinished && streaming && !waiting
  const failed = call.status === "failed" && !isRejection(outcome) && question?.outcome !== "skipped"
  const text = (call.status === "completed" || question?.outcome === "answered") && !isRejection(outcome) ? words.done : words.now
  const canOpen = !running && !waiting && hasResult(call, question)
  const answered = question?.outcome === "skipped" ? "Skipped" : question?.outcome === "cancelled" ? "Not answered" : undefined
  let right: React.ReactNode = stepMeta(call)
  if (waiting) right = <WaitingLabel />
  else if (running) right = call.status === "in_progress" ? <Spinner className="size-3.5" /> : undefined
  else if (unfinished && !streaming) right = "Stopped"
  return (
    <div className="border-t first:border-t-0">
      <StepLine
        words={text}
        live={running && call.status === "in_progress"}
        open={open}
        onToggle={canOpen ? () => setOpen((o) => !o) : undefined}
        after={
          failed ? (
            <span className="shrink-0 text-detail text-destructive">Failed</span>
          ) : outcome || answered ? (
            <span className="shrink-0 text-detail text-muted-foreground">{answered ?? outcomeLabel[outcome!]}</span>
          ) : undefined
        }
        right={right}
      />
      <Unfold open={open}>
        <ResultBox>
          <StepResult call={call} question={question} />
        </ResultBox>
      </Unfold>
    </div>
  )
}

// Neighbouring steps of one kind, as one row ("Read 3 files") that opens to each of them
function FoldRow({ steps, group, asks, streaming }: { steps: WordedStep[]; group: string; asks: StepAsks; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const hosts = [...new Set(steps.map(({ call }) => stepMeta(call)).filter(Boolean))]
  return (
    <div className="border-t first:border-t-0">
      <StepLine
        words={capital(groupPhrase(group, steps.length))}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        right={group === "fetch" && hosts.length === 1 ? hosts[0] : undefined}
      />
      <Unfold open={open}>
        <div className="mb-2 ml-3 border-l">
          {steps.map(({ call, words }) => (
            <ToolRow key={call.toolCallId} call={call} words={words} asks={asks} streaming={streaming} />
          ))}
        </div>
      </Unfold>
    </div>
  )
}

function ThoughtRow({ part, live }: { part: Part<"thought">; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t first:border-t-0">
      <StepLine words={live ? "Thinking" : "Thought"} live={live} open={open} onToggle={!live && part.text.trim() ? () => setOpen((o) => !o) : undefined} />
      <Unfold open={open}>
        <ResultBox>
          <div className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{part.text}</div>
        </ResultBox>
      </Unfold>
    </div>
  )
}

// ---- The block ----

type Row =
  | { type: "thought"; key: string; part: Part<"thought">; live: boolean }
  | ({ type: "step"; key: string } & WordedStep)
  | { type: "fold"; key: string; group: string; steps: WordedStep[] }

function rowsOf(parts: StepPart[], wordsOf: Map<ToolCall, StepWords>, active: boolean, asks: StepAsks): Row[] {
  const rows: Row[] = []
  // A step done without asking the user anything
  const settled = (c: ToolCall) => c.status === "completed" && !asks.outcomes[c.toolCallId] && !asks.questions[c.toolCallId]
  parts.forEach((p, i) => {
    if (p.type === "thought") {
      if (p.text.trim()) rows.push({ type: "thought", key: `t${i}`, part: p, live: active && i === parts.length - 1 })
      return
    }
    const words = wordsOf.get(p)!
    if (words.hidden) return
    // Done steps of a foldable kind join the row before them when it is of the same kind
    const last = rows.at(-1)
    if (settled(p) && foldable(words.group) && last && last.type !== "thought") {
      const lastGroup = last.type === "fold" ? last.group : last.words.group
      if (lastGroup === words.group && (last.type === "fold" || settled(last.call))) {
        const steps = last.type === "fold" ? last.steps : [{ call: last.call, words: last.words }]
        rows[rows.length - 1] = { type: "fold", key: last.key, group: words.group, steps: [...steps, { call: p, words }] }
        return
      }
    }
    rows.push({ type: "step", key: p.toolCallId, call: p, words })
  })
  return rows
}

// An edit to the user's files that failed and that no later step saved: the one failure the folded line
// warns about, so an answer saying it is done can't hide it
function unsaved(calls: ToolCall[], outcomes: PermissionOutcomes) {
  const writes = calls.filter((c) => ["edit", "delete", "move"].includes(c.kind))
  for (const [i, c] of writes.entries()) {
    if (c.status !== "failed" || isRejection(outcomes[c.toolCallId])) continue
    const path = pathOf(c)
    if (!path) continue
    if (writes.slice(i + 1).some((later) => later.status === "completed" && pathOf(later) === path)) continue
    return fileName(path)
  }
  return undefined
}

// While it runs only the last few steps show, the rest folded into one line above them
const LIVE_ROWS = 3

// Consecutive thoughts and tool calls of one answer, as one block: a sentence saying what was done (open
// while the block is the live one, closed once the answer starts), and under it a list of plain-sentence
// steps, each opening to what it got.
export function StepsPart({ parts, active, streaming, asks }: { parts: StepPart[]; active: boolean; streaming: boolean; asks: StepAsks }) {
  const waitingHere = !!asks.waiting && parts.some((p) => p.type === "tool_call" && p.toolCallId === asks.waiting)
  const live = active || waitingHere
  const [open, setOpen] = useOpenWhile(live)
  const [earlier, setEarlier] = useState(false)

  const calls = parts.filter((p): p is ToolCall => p.type === "tool_call")
  // Each step's words, worked out once for the rows and the sentences
  const steps = calls.map((call) => ({ call, words: stepWords(call, asks.questions[call.toolCallId]?.questions.length) }))
  const wordsOf = new Map(steps.map((s) => [s.call, s.words]))
  const rows = rowsOf(parts, wordsOf, active, asks)
  const failed = calls.filter((c) => c.status === "failed" && !isRejection(asks.outcomes[c.toolCallId]) && asks.questions[c.toolCallId]?.outcome !== "skipped").length
  const refused = calls.filter((c) => isRejection(asks.outcomes[c.toolCallId]) && asks.outcomes[c.toolCallId] !== "cancelled").length
  const shown = steps.filter((s) => !s.words.hidden)
  // Steps the answer stopped in the middle of; their rows say "Stopped"
  const stopped = streaming ? 0 : shown.filter(({ call: c }) => (c.status === "pending" || c.status === "in_progress") && !isRejection(asks.outcomes[c.toolCallId])).length
  const lost = !live ? unsaved(calls, asks.outcomes) : undefined

  let head: React.ReactNode
  if (waitingHere) {
    head = <WaitingLabel size="md" />
  } else if (active) {
    const thinking = parts.at(-1)?.type === "thought"
    head = (
      <>
        <span className="truncate shimmer">{thinking ? "Thinking" : liveSentence(steps)}</span>
        {shown.length > 1 && <span className="shrink-0 text-muted-foreground">· {shown.length} so far</span>}
      </>
    )
  } else if (lost) {
    head = (
      <>
        <CircleAlertIcon className="size-4 shrink-0 text-warning" />
        <span className="truncate text-foreground">Couldn't save {lost}</span>
      </>
    )
  } else {
    head = (
      <>
        <span className="truncate">{blockSentence(steps)}</span>
        {(failed > 0 || refused > 0 || stopped > 0) && (
          <span className="shrink-0 text-muted-foreground">
            ({[failed && `${failed} failed`, refused && `${refused} not allowed`, stopped && `${stopped} stopped`].filter(Boolean).join(", ")})
          </span>
        )}
      </>
    )
  }

  // The earlier rows unfold where the "N earlier steps" line was, and the line folds away as they do
  const hidden = live && rows.length > LIVE_ROWS + 1 ? rows.length - LIVE_ROWS : 0
  const row = (r: Row) =>
    r.type === "thought" ? (
      <ThoughtRow key={r.key} part={r.part} live={r.live} />
    ) : r.type === "fold" ? (
      <FoldRow key={r.key} steps={r.steps} group={r.group} asks={asks} streaming={streaming} />
    ) : (
      <ToolRow key={r.key} call={r.call} words={r.words} asks={asks} streaming={streaming} />
    )
  return (
    <FoldingBlock open={open} onOpenChange={setOpen} head={head}>
      {rows.length > 0 && (
        <FoldingList>
          {hidden > 0 && (
            <>
              <Unfold open={!earlier}>
                <div className="border-t first:border-t-0">
                  <StepLine words={plural(hidden, "earlier step")} open={false} onToggle={() => setEarlier(true)} className="text-detail" />
                </div>
              </Unfold>
              <Unfold open={earlier}>{rows.slice(0, hidden).map(row)}</Unfold>
            </>
          )}
          {rows.slice(hidden).map(row)}
        </FoldingList>
      )}
    </FoldingBlock>
  )
}

// A plan reads like the steps block: a quiet label and a ruled list, no card. While it is under way it
// stays open; once every entry is done it folds into its "done of total" line, as finished steps do, so a
// finished hand-off leads with its answer.
export function PlanPart({ part }: { part: Part<"plan"> }) {
  const done = part.entries.filter((e) => e.status === "completed").length
  const finished = part.entries.length > 0 && done === part.entries.length
  const [open, setOpen] = useOpenWhile(!finished)
  return (
    <FoldingBlock
      open={open}
      onOpenChange={setOpen}
      className="text-sm"
      head={
        <span>
          Plan · {done}/{part.entries.length}
        </span>
      }
    >
      <ol className="mt-1.5 ml-1.5 flex flex-col gap-1 border-l-2 pl-3">
        {part.entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 py-0.5">
            {e.status === "completed" ? (
              <CheckIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
            ) : e.status === "in_progress" ? (
              <CircleDotIcon className="mt-[3px] size-3.5 shrink-0 text-foreground" />
            ) : (
              <CircleIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span className={cn(e.status !== "in_progress" && "text-muted-foreground")}>{e.content}</span>
          </li>
        ))}
      </ol>
    </FoldingBlock>
  )
}

// A permission or question whose step isn't in the message (an agent may ask without announcing one):
// one muted line, since its buttons are above the composer
export function LooseAskPart({ part, waiting }: { part: Part<"permission"> | Part<"question">; waiting: boolean }) {
  if (waiting)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <WaitingLabel size="md" />
      </div>
    )
  const said =
    part.type === "permission"
      ? `${outcomeLabel[part.outcome ?? "cancelled"]} · ${toolTitle(part.title)}`
      : part.outcome === "answered"
        ? `Answered ${part.questions.length === 1 ? "a question" : `${part.questions.length} questions`}`
        : part.outcome === "skipped"
          ? "Skipped a question"
          : "A question went unanswered"
  const allowed = part.type === "permission" ? !isRejection(part.outcome) : part.outcome === "answered"
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {allowed ? <CheckIcon className="size-4 shrink-0" /> : <XIcon className="size-4 shrink-0" />}
      <span className="truncate">{said}</span>
    </div>
  )
}

export function TextPart({ part }: { part: Part<"text"> }) {
  return <Markdown text={part.text} />
}
