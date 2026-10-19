import { t } from "@lingui/core/macro"
import { useState } from "react"
import { type AttachmentFile, type ChatMessage, chatOfFile, type MessagePart, withoutAgentError } from "@owlit/protocol"
import { CircleXIcon, FilePlusIcon, PencilIcon, RefreshCwIcon } from "lucide-react"
import { CopyButton } from "@/components/copy-button"
import { IconButton } from "@/components/icon-button"
import { Quote } from "@/components/quote"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { timeStamp } from "@/lib/time"
import { AttachmentList } from "../composer/AttachmentList"
import { importCopy, openAttached } from "../../lib/attachments"
import { useChatStore } from "../../store"
import { MentionBadge } from "../composer/MentionBadge"
import { unansweredSentence } from "../../lib/step-words"
import { messageText } from "../../lib/message-text"
import { LooseAskPart, PlanPart, StepsPart, TextPart, type StepAsks, type StepPart } from "./parts"
import { ResultCard } from "./ResultRows"
import { AgentsPart, AgentsWaitLine, type AgentPart } from "./agents"

// The one red mark a reply can have, as a small bordered block (the result card's frame) so it reads as
// one thing apart from the answer and its results, rather than a line that wraps: "Owlit stopped"
// with Retry and Dismiss on its right, then why in owlit's words as a muted sentence, and what it was still
// asking to do, since that never happened and the steps line alone reads as done. The agent's own words (an
// API error) are a detail folded under Details, since they mean little on their own and the agent is named
// only where it is picked.
function StoppedNote({ message, onRetry, onDismiss }: { message: ChatMessage; onRetry?: () => void; onDismiss?: () => void }) {
  const [details, setDetails] = useState(false)
  const detail = message.errorDetail && message.errorDetail !== message.error ? message.errorDetail : undefined
  const why = [message.error, unansweredSentence(message.parts)].filter(Boolean).join(" ")
  return (
    <div className="rounded-lg border py-2 pr-2 pl-3 text-detail text-muted-foreground" role="status">
      <div className="flex items-center gap-1.5">
        <CircleXIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="text-destructive">{t`Owlit stopped`}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {detail && (
            <Button variant="text" size="inline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {t`Details`}
            </Button>
          )}
          {onDismiss && (
            <Button variant="text" size="inline" onClick={onDismiss}>
              {t({ message: "Dismiss", comment: "verb: leave a broken reply as it is" })}
            </Button>
          )}
          {onRetry && (
            <Button variant="text" size="inline" onClick={onRetry}>
              {t({ message: "Retry", comment: "verb: send the question again" })}
            </Button>
          )}
        </span>
      </div>
      {why && <p className="mt-0.5 pl-5 leading-relaxed">{why}</p>}
      {details && detail && <p className="mt-1.5 ml-5 rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{detail}</p>}
    </div>
  )
}

// Fold consecutive thoughts and tool calls into one steps block; everything else stays a part.
// A permission or question belongs to its tool call's row (waiting, then its outcome), so the steps on
// either side of it merge; its buttons are above the composer. The agents the answering agent handed work
// to sit together where they were handed out, and their steps go to them, not into the answer's steps.
type Segment =
  | { type: "steps"; key: string; parts: StepPart[] }
  | { type: "agents"; key: string; agents: AgentPart[] }
  | { type: "part"; key: string; part: Exclude<MessagePart, StepPart | AgentPart> }
function segment(parts: MessagePart[], streaming: boolean): { segments: Segment[]; asks: StepAsks; byAgent: Record<string, StepPart[]> } {
  const toolCallIds = new Set(parts.flatMap((p) => (p.type === "tool_call" ? [p.toolCallId] : [])))
  const asks: StepAsks = { outcomes: {}, questions: {} }
  const byAgent: Record<string, StepPart[]> = {}
  const out: Segment[] = []
  parts.forEach((p, i) => {
    if ((p.type === "permission" || p.type === "question") && p.toolCallId && toolCallIds.has(p.toolCallId)) {
      if (p.type === "permission" && p.outcome) asks.outcomes[p.toolCallId] = p.outcome
      if (p.type === "question") asks.questions[p.toolCallId] = p
      if (!p.outcome && streaming) asks.waiting = p.toolCallId
      return
    }
    if (p.type === "tool_call" && p.agentId) {
      ;(byAgent[p.agentId] ??= []).push(p)
      return
    }
    if (p.type === "agent") {
      const last = out[out.length - 1]
      if (last?.type === "agents") last.agents.push(p)
      else out.push({ type: "agents", key: `agents-${i}`, agents: [p] })
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
  return { segments: out, asks, byAgent }
}

// A PDF sent with a message, added to the Library from its chip: the chip says so from then on
async function addSentToLibrary(message: ChatMessage, file: AttachmentFile) {
  const paper = await importCopy(file)
  const chatId = file.path ? chatOfFile(file.path) : null
  if (paper && chatId) useChatStore.getState().setAttachmentPaper(chatId, message.id, file.id, paper.id)
}

// Split "@[label]" markers out of the text so they can render as chips
function renderWithMentions(text: string, mentions: ChatMessage["mentions"]) {
  const parts = text.split(/(@\[[^\]]+\])/g)
  return parts.map((p, i) => {
    const m = /^@\[([^\]]+)\]$/.exec(p)
    if (!m) return p
    // The marker holds the label the composer showed ("Vaswani et al. 2017"), kept with the mention
    const item = mentions?.find((x) => (x as { label?: string }).label === m[1] || x.title === m[1])
    return item ? <MentionBadge key={i} item={item} className="mx-px align-baseline" /> : m[1]
  })
}

export function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit?: (text: string) => void }) {
  const text = messageText(message)
  return (
    <Message align="end" className="text-body">
      <MessageContent className="items-end">
        {/* The passage it was sent with: one quiet quoted line, not a card */}
        {message.selection && (
          <Quote side="right" clamp={1} title={message.selection.text} className="max-w-[85%]">
            “{message.selection.text.replace(/\s+/g, " ").trim()}”
          </Quote>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList files={message.attachments} size="xs" onOpen={openAttached} onAddToLibrary={(file) => addSentToLibrary(message, file)} />
        )}
        <Bubble variant="secondary" align="end">
          <BubbleContent className="whitespace-pre-wrap">{renderWithMentions(text, message.mentions)}</BubbleContent>
        </Bubble>
      </MessageContent>
      <MessageFooter className="absolute -bottom-7 right-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
        <CopyButton text={text} />
        {onEdit && (
          <IconButton label={t`Edit message`} size="icon-xs" onClick={() => onEdit(text)}>
            <PencilIcon />
          </IconButton>
        )}
      </MessageFooter>
    </Message>
  )
}

export function AssistantMessage({
  chatId,
  message: saved,
  modelName,
  onRegenerate,
  onDismiss,
  onSaveAsDoc,
}: {
  chatId: string
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
  // Only the footer, drawn once the reply is done, uses the text
  const text = streaming ? "" : messageText(message)
  const { segments, asks, byAgent } = segment(message.parts, streaming)
  const waiting = streaming && message.parts.some((p) => (p.type === "permission" || p.type === "question") && !p.outcome)
  // The last block of agents still at work, for the reply's last line
  const working = streaming ? message.parts.filter((p) => p.type === "agent" && p.status === "working").length : 0
  const workingBlock = working ? [...segments].reverse().find((s) => s.type === "agents" && s.agents.some((a) => a.status === "working")) : undefined
  const agentWaiting = waiting && message.parts.some((p) => (p.type === "permission" || p.type === "question") && !p.outcome && !!p.agentId)
  // Something of the reply is on screen: words, a steps block or the agents it handed work to. Until the
  // first of these arrives (the seconds after Send) the reply would be blank
  const showing = segments.some((s) => s.type !== "part" || s.part.type !== "text" || s.part.text.trim() !== "")
  // The last part says nothing about what comes next (a plan, an answered ask, an agent's own step)
  const quietLast = !!last && (last.type === "plan" || last.type === "permission" || last.type === "question" || last.type === "agent" || (last.type === "tool_call" && !!last.agentId))
  const blank = streaming && !waiting && !workingBlock && (!showing || quietLast)
  const blockId = (key: string) => `${message.id}-${key}`
  // Words come on at an even pace while the answer is written; a stopped or broken one shows all it has
  const pace = streaming ? "live" : message.status === "done" ? "ending" : "off"
  return (
    <Message className="text-body">
      <MessageContent className="gap-3">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          if (seg.type === "steps") return <StepsPart key={seg.key} parts={seg.parts} active={streaming && isLast && !waiting} streaming={streaming} asks={asks} />
          if (seg.type === "agents") return <AgentsPart key={seg.key} id={blockId(seg.key)} agents={seg.agents} stepsOf={(id) => byAgent[id] ?? []} streaming={streaming} asks={asks} />
          const { part } = seg
          switch (part.type) {
            case "text":
              return <TextPart key={seg.key} part={part} pace={pace} />
            case "plan":
              return <PlanPart key={seg.key} part={part} />
            case "permission":
            case "question":
              return <LooseAskPart key={seg.key} part={part} waiting={streaming && !part.outcome} />
          }
        })}
        {workingBlock && <AgentsWaitLine blockId={blockId(workingBlock.key)} working={working} waiting={agentWaiting} />}
        {/* The reply at work before it has anything to show: the steps line's own look (14px at 80%, the
            words shimmering), no spinner, where the answer will appear */}
        {blank && (
          <div className="flex items-center text-sm text-foreground/80">
            <span className="shimmer">{t`Working…`}</span>
          </div>
        )}
        {!streaming && <ResultCard message={message} chatId={chatId} />}
        {message.status === "error" && <StoppedNote message={message} onRetry={onRegenerate} onDismiss={onDismiss} />}
      </MessageContent>
      {!streaming && (
        <MessageFooter className="absolute -bottom-7 left-0 gap-0.5 px-0">
          {/* A partial answer says so at all times, in the same muted tone (stopping was the user's
              choice, never red), since it may read as whole */}
          {message.status === "cancelled" && <span className="mr-0.5 text-xs font-normal text-muted-foreground">{t`Stopped, partial`}</span>}
          {/* Which model answered and when it ended show with the actions on hover, so a long chat
              reads as the answers alone; they line up with the answer's left edge */}
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
            <span className="mr-1 text-xs font-normal text-muted-foreground">
              {message.status === "cancelled" && "· "}
              {[modelName, timeStamp(message.finishedAt ?? message.createdAt)].filter(Boolean).join(" · ")}
            </span>
            {text && <CopyButton text={text} />}
            {text && onSaveAsDoc && (
              <IconButton label={t`Save as doc`} size="icon-xs" onClick={() => onSaveAsDoc(text)}>
                <FilePlusIcon />
              </IconButton>
            )}
            {onRegenerate && (
              <IconButton label={t({ message: "Regenerate", comment: "verb: ask for the answer again" })} size="icon-xs" onClick={onRegenerate}>
                <RefreshCwIcon />
              </IconButton>
            )}
          </span>
        </MessageFooter>
      )}
    </Message>
  )
}
