import { useState } from "react"
import { withoutAgentError } from "@owlit/protocol"
import { CheckIcon, CircleXIcon, CopyIcon, FilePlusIcon, PencilIcon, RefreshCwIcon } from "lucide-react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ChatMessage, MessagePart } from "../../types"
import { AttachmentList } from "../composer/AttachmentList"
import { MentionBadge } from "../composer/MentionBadge"
import { KnowledgeUpdates } from "@/features/knowledge/components/ChatUpdates"
import { unansweredSentence } from "../../lib/step-words"
import { LooseAskPart, PlanPart, StepsPart, TextPart, type StepAsks, type StepPart } from "./parts"
import { ResultRows } from "./ResultRows"

function messageText(m: ChatMessage) {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  )
}

// A small text button in a muted line (Retry, Dismiss), 24px tall so it is easy to hit
const TEXT_BUTTON = "inline-flex h-6 items-center rounded-md px-1.5 text-foreground outline-none hover:bg-muted focus-key:bg-muted"

// The one red mark a reply can have, as a small block rather than a line that wraps: "Owlit stopped"
// with Retry and Dismiss on its right, then why in owlit's words as a muted sentence, and what it was still
// asking to do, since that never happened and the steps line alone reads as done. The agent's own words (an
// API error) are a detail folded under Details, since they mean little on their own and the agent is named
// only where it is picked.
function StoppedNote({ message, onRetry, onDismiss }: { message: ChatMessage; onRetry?: () => void; onDismiss?: () => void }) {
  const [details, setDetails] = useState(false)
  const detail = message.errorDetail && message.errorDetail !== message.error ? message.errorDetail : undefined
  const why = [message.error, unansweredSentence(message.parts)].filter(Boolean).join(" ")
  return (
    <div className="text-[13px] text-muted-foreground" role="status">
      <div className="flex items-center gap-1.5">
        <CircleXIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="text-destructive">Owlit stopped</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {detail && (
            <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)} className={TEXT_BUTTON}>
              Details
            </button>
          )}
          {onDismiss && (
            <button type="button" onClick={onDismiss} className={TEXT_BUTTON}>
              Dismiss
            </button>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className={TEXT_BUTTON}>
              Retry
            </button>
          )}
        </span>
      </div>
      {why && <p className="mt-0.5 pl-5 leading-relaxed">{why}</p>}
      {details && detail && <p className="mt-1.5 ml-5 rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{detail}</p>}
    </div>
  )
}

const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

// Fold consecutive thoughts and tool calls into one steps block; everything else stays a part.
// A permission or question belongs to its tool call's row (waiting, then its outcome), so the steps on
// either side of it merge; its buttons are above the composer.
type Segment = { type: "steps"; key: string; parts: StepPart[] } | { type: "part"; key: string; part: Exclude<MessagePart, StepPart> }
function segment(parts: MessagePart[], streaming: boolean): { segments: Segment[]; asks: StepAsks } {
  const toolCallIds = new Set(parts.flatMap((p) => (p.type === "tool_call" ? [p.toolCallId] : [])))
  const asks: StepAsks = { outcomes: {}, questions: {} }
  const out: Segment[] = []
  parts.forEach((p, i) => {
    if ((p.type === "permission" || p.type === "question") && p.toolCallId && toolCallIds.has(p.toolCallId)) {
      if (p.type === "permission" && p.outcome) asks.outcomes[p.toolCallId] = p.outcome
      if (p.type === "question") asks.questions[p.toolCallId] = p
      if (!p.outcome && streaming) asks.waiting = p.toolCallId
      return
    }
    if (p.type === "thought" || p.type === "tool_call") {
      const last = out[out.length - 1]
      if (last?.type === "steps") last.parts.push(p)
      else out.push({ type: "steps", key: `steps-${i}`, parts: [p] })
    } else {
      out.push({ type: "part", key: p.type === "permission" || p.type === "question" ? p.requestId : `${p.type}-${i}`, part: p })
    }
  })
  return { segments: out, asks }
}

// Split "@[label]" markers out of the text so they can render as chips
function renderWithMentions(text: string, mentions: ChatMessage["mentions"]) {
  const parts = text.split(/(@\[[^\]]+\])/g)
  return parts.map((p, i) => {
    const m = /^@\[([^\]]+)\]$/.exec(p)
    if (!m) return p
    const item = mentions?.find((x) => x.title === m[1])
    return item ? <MentionBadge key={i} item={item} className="mx-px align-baseline" /> : m[1]
  })
}

export function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit?: (text: string) => void }) {
  const text = messageText(message)
  return (
    <Message align="end" className="text-[15px]">
      <MessageContent className="items-end">
        {/* The passage it was sent with: one quiet quoted line, not a card */}
        {message.selection && (
          <p className="max-w-[85%] truncate border-r-2 pr-2 text-[13px] text-muted-foreground" title={message.selection.text}>
            “{message.selection.text.replace(/\s+/g, " ").trim()}”
          </p>
        )}
        {message.attachments && message.attachments.length > 0 && <AttachmentList files={message.attachments} size="xs" />}
        <Bubble variant="secondary" align="end">
          <BubbleContent className="whitespace-pre-wrap">{renderWithMentions(text, message.mentions)}</BubbleContent>
        </Bubble>
      </MessageContent>
      <MessageFooter className="absolute -bottom-7 right-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
        <CopyButton text={text} />
        {onEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Edit message" onClick={() => onEdit(text)}>
                <PencilIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        )}
      </MessageFooter>
    </Message>
  )
}

export function AssistantMessage({
  message: saved,
  modelName,
  onRegenerate,
  onDismiss,
  onSaveAsDoc,
}: {
  message: ChatMessage
  modelName?: string
  onRegenerate?: () => void
  // Leaves a broken reply as it is, so the chat stops asking for the user (only while it does)
  onDismiss?: () => void
  // Keeps the answer's text as a doc
  onSaveAsDoc?: (markdown: string) => void
}) {
  // A reply saved before the agent's error text was kept apart still has it as its last text
  const message = withoutAgentError(saved)
  const streaming = message.status === "streaming"
  const last = message.parts[message.parts.length - 1]
  const text = messageText(message)
  const { segments, asks } = segment(message.parts, streaming)
  const waiting = streaming && message.parts.some((p) => (p.type === "permission" || p.type === "question") && !p.outcome)
  return (
    <Message className="text-[15px]">
      <MessageContent className="gap-3">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          if (seg.type === "steps") return <StepsPart key={seg.key} parts={seg.parts} active={streaming && isLast && !waiting} streaming={streaming} asks={asks} />
          const { part } = seg
          switch (part.type) {
            case "text":
              return <TextPart key={seg.key} part={part} />
            case "plan":
              return <PlanPart key={seg.key} part={part} />
            case "permission":
            case "question":
              return <LooseAskPart key={seg.key} part={part} waiting={streaming && !part.outcome} />
          }
        })}
        {streaming && !waiting && (!last || last.type === "plan" || last.type === "permission" || last.type === "question") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Working…
          </div>
        )}
        {!streaming && <KnowledgeUpdates parts={message.parts} />}
        <ResultRows messageId={message.id} />
        {message.status === "error" && <StoppedNote message={message} onRetry={onRegenerate} onDismiss={onDismiss} />}
      </MessageContent>
      {!streaming && (
        <MessageFooter className="absolute -bottom-7 left-0 gap-0.5 px-0">
          {/* A partial answer says so at all times, in the same muted tone (stopping was the user's
              choice, never red), since it may read as whole */}
          {message.status === "cancelled" && <span className="mr-0.5 text-xs font-normal text-muted-foreground">Stopped, partial</span>}
          {/* Which model answered and when it ended show with the actions on hover, so a long chat
              reads as the answers alone; they line up with the answer's left edge */}
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
            <span className="mr-1 text-xs font-normal text-muted-foreground">
              {message.status === "cancelled" && "· "}
              {[modelName, timeOf(message.finishedAt ?? message.createdAt)].filter(Boolean).join(" · ")}
            </span>
            {text && <CopyButton text={text} />}
            {text && onSaveAsDoc && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Save as doc" onClick={() => onSaveAsDoc(text)}>
                    <FilePlusIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Save as doc</TooltipContent>
              </Tooltip>
            )}
            {onRegenerate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Regenerate" onClick={onRegenerate}>
                    <RefreshCwIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Regenerate</TooltipContent>
              </Tooltip>
            )}
          </span>
        </MessageFooter>
      )}
    </Message>
  )
}
