import { useState } from "react"
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
import { PermissionPart, PlanPart, StepsPart, TextPart, type PermissionOutcomes, type StepPart } from "./parts"
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

const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

// Fold consecutive thoughts and tool calls into one steps block; everything else stays a part.
// An answered permission folds into its tool call's row, so the steps on either side of it merge.
type Segment = { type: "steps"; key: string; parts: StepPart[] } | { type: "part"; key: string; part: Exclude<MessagePart, StepPart> }
function segment(parts: MessagePart[]): { segments: Segment[]; outcomes: PermissionOutcomes } {
  const toolCallIds = new Set(parts.flatMap((p) => (p.type === "tool_call" ? [p.toolCallId] : [])))
  const outcomes: PermissionOutcomes = {}
  const out: Segment[] = []
  parts.forEach((p, i) => {
    if (p.type === "permission" && p.outcome && toolCallIds.has(p.toolCallId)) {
      outcomes[p.toolCallId] = p.outcome
      return
    }
    if (p.type === "thought" || p.type === "tool_call") {
      const last = out[out.length - 1]
      if (last?.type === "steps") last.parts.push(p)
      else out.push({ type: "steps", key: `steps-${i}`, parts: [p] })
    } else {
      out.push({ type: "part", key: p.type === "permission" ? p.requestId : `${p.type}-${i}`, part: p })
    }
  })
  return { segments: out, outcomes }
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
  message,
  modelName,
  onRespondPermission,
  onRegenerate,
  onSaveAsDoc,
}: {
  message: ChatMessage
  modelName?: string
  onRespondPermission: (requestId: string, optionId: string) => void
  onRegenerate?: () => void
  // Keeps the answer's text as a doc
  onSaveAsDoc?: (markdown: string) => void
}) {
  const streaming = message.status === "streaming"
  const last = message.parts[message.parts.length - 1]
  const text = messageText(message)
  const { segments, outcomes } = segment(message.parts)
  return (
    <Message className="text-[15px]">
      <MessageContent className="gap-3">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          if (seg.type === "steps") return <StepsPart key={seg.key} parts={seg.parts} active={streaming && isLast} outcomes={outcomes} />
          const { part } = seg
          switch (part.type) {
            case "text":
              return <TextPart key={seg.key} part={part} />
            case "plan":
              return <PlanPart key={seg.key} part={part} />
            case "permission":
              return <PermissionPart key={seg.key} part={part} onRespond={(optionId) => onRespondPermission(part.requestId, optionId)} />
          }
        })}
        {streaming && (!last || last.type === "plan" || last.type === "permission") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {last?.type === "permission" && !last.outcome ? "Waiting for permission" : "Working…"}
          </div>
        )}
        {!streaming && <KnowledgeUpdates parts={message.parts} />}
        <ResultRows messageId={message.id} />
        {/* The one red line a reply can have: what stopped it, and a way to run it again */}
        {message.status === "error" && (
          <p className="flex items-center gap-1.5 text-[13px] text-destructive">
            <CircleXIcon className="size-3.5 shrink-0" />
            <span>{message.error || "Something went wrong"}</span>
            {onRegenerate && (
              <button type="button" onClick={onRegenerate} className="rounded-md px-1 text-foreground outline-none hover:bg-muted focus-key:bg-muted">
                Retry
              </button>
            )}
          </p>
        )}
      </MessageContent>
      {!streaming && (
        <MessageFooter className="absolute -bottom-7 left-0 gap-0.5 px-0">
          {/* Which model answered, and when, stays visible and lines up with the answer's left edge;
              the actions appear after it on hover, so they never push it in */}
          <span className="mr-1 text-xs font-normal text-muted-foreground">
            {/* Stopping was the user's choice: said in the same muted tone, never red */}
            {[modelName, timeOf(message.createdAt), message.status === "cancelled" && "Stopped, partial"].filter(Boolean).join(" · ")}
          </span>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
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
