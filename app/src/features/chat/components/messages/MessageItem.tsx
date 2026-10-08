import { useState } from "react"
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "cn"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ChatMessage } from "../../types"
import { AttachmentList } from "../composer/AttachmentList"
import { MentionBadge } from "../composer/MentionBadge"
import { PermissionPart, PlanPart, TextPart, ThoughtPart, ToolCallPart } from "./parts"

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
    <Message align="end">
      <MessageContent className="items-end">
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
}: {
  message: ChatMessage
  modelName?: string
  onRespondPermission: (requestId: string, optionId: string) => void
  onRegenerate?: () => void
}) {
  const streaming = message.status === "streaming"
  const last = message.parts[message.parts.length - 1]
  const text = messageText(message)
  return (
    <Message>
      <MessageContent className="gap-3">
        {message.parts.map((part, i) => {
          const isLast = i === message.parts.length - 1
          switch (part.type) {
            case "text":
              return <TextPart key={i} part={part} />
            case "thought":
              return <ThoughtPart key={i} part={part} streaming={streaming && isLast} />
            case "tool_call":
              return <ToolCallPart key={part.toolCallId} part={part} />
            case "plan":
              return <PlanPart key={i} part={part} />
            case "permission":
              return <PermissionPart key={part.requestId} part={part} onRespond={(optionId) => onRespondPermission(part.requestId, optionId)} />
          }
        })}
        {streaming && (!last || last.type === "tool_call" || last.type === "plan" || last.type === "permission") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {last?.type === "permission" && !last.outcome ? "Waiting for permission" : "Working…"}
          </div>
        )}
        {message.status === "cancelled" && <div className="text-xs text-muted-foreground">Stopped.</div>}
        {message.status === "error" && <div className="text-xs text-destructive">Something went wrong: {message.error}</div>}
      </MessageContent>
      {!streaming && (
        <MessageFooter className={cn("absolute -bottom-7 left-0 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100")}>
          {text && <CopyButton text={text} />}
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
          {modelName && <span className="ml-1 text-xs text-muted-foreground">{modelName}</span>}
        </MessageFooter>
      )}
    </Message>
  )
}
