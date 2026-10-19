import { t } from "@lingui/core/macro"
import { memo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { saveAnswerAsDoc } from "@/features/docs/save-as-doc"
import { useChatStore } from "../store"
import { useBrokenReply, useSeenStore } from "../status"
import { regenerate } from "../lib/regenerate"
import { modelNameOf, roleName, roleOf } from "../lib/selection"
import { DEFAULT_ROLE, type Chat, type ChatMessage } from "@owlit/protocol"
import { AssistantMessage, QueuedMessage, UserMessage } from "./messages/MessageItem"

// A chat's messages, on the Chat page or in the docked agent panel (`panel`): the same conversation at
// two sizes. `onEdit` puts a sent question back in the composer; `seek` is a message to bring up, once
// (`onSought` says it was asked for).
export function ChatMessages({
  chat,
  streaming,
  panel = false,
  onEdit,
  seek,
  onSought,
}: {
  chat: Chat
  streaming: boolean
  panel?: boolean
  onEdit?: (text: string) => void
  seek?: string
  onSought?: () => void
}) {
  const connectors = useChatStore((s) => s.connectors)
  const queued = useChatStore((s) => !!s.queued[chat.id])
  const broken = useBrokenReply(chat)
  return (
    // One scroller per chat, so switching chats opens the next one at its end
    <MessageScrollerProvider key={chat.id}>
      {seek && <SeekMessage messageId={seek} onDone={onSought} />}
      <MessageScroller className={cn("flex-1", panel && "min-h-0")}>
        <MessageScrollerViewport className="px-4" aria-label={t`Messages`}>
          <MessageScrollerContent className={panel ? "w-full gap-1 py-2 pb-10" : "mx-auto w-full max-w-3xl gap-1 py-6 pb-12"}>
            {/* A chat in another role than the usual says so before its first message, so a Reviewer chat
                reads as one before Owlit's first "I can't edit"; the panel says it in its header instead */}
            {!panel && chat.messages.length > 0 && roleOf(chat).id !== DEFAULT_ROLE && (
              <p className="pb-5 text-center text-detail text-muted-foreground">{t`In this chat, Owlit works as ${roleName(roleOf(chat).id)}`}</p>
            )}
            {/* Items sit directly in the content: the scroller only sees its direct children, so a wrapper
                hides new messages from it and a sent question never moves to the top.
                Items carry the spacing as bottom padding so the hover footers, which hang below each
                message, stay inside the item's paint containment instead of being clipped. The latest
                exchange always renders: skipped off screen, a just-sent question would be measured at its
                placeholder height, and the scroller would anchor it a frame early and then jump */}
            {chat.messages.map((m, i) => (
              <MessageScrollerItem key={m.id} id={`message-${m.id}`} messageId={m.id} scrollAnchor={m.role === "user"} className={cn("pb-7", i >= chat.messages.length - 2 && "[content-visibility:visible]")}>
                <MessageRow
                  chatId={chat.id}
                  message={m}
                  index={i}
                  modelName={m.role === "assistant" ? modelNameOf(connectors, m.connectorId, m.modelId) : undefined}
                  canRegenerate={m.role === "assistant" && !streaming}
                  broken={broken?.messageId === m.id}
                  onEdit={onEdit}
                />
              </MessageScrollerItem>
            ))}
            {queued && (
              <MessageScrollerItem key="queued" className="pb-7 [content-visibility:visible]">
                <QueuedMessage chatId={chat.id} />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Floats above the text like a menu would: popover surface and a soft shadow */}
        <MessageScrollerButton className={cn(panel ? "bottom-4" : "bottom-6", "bg-popover shadow-md")} />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

// Brings one message to the top. The scroller holds the request until the message is drawn (a chat whose
// messages are still loading), and it then skips settling at the chat's end.
function SeekMessage({ messageId, onDone }: { messageId: string; onDone?: () => void }) {
  const { scrollToMessage } = useMessageScroller()
  useEffect(() => {
    scrollToMessage(messageId, { align: "start", behavior: "smooth" })
    onDone?.()
  }, [messageId, scrollToMessage, onDone])
  return null
}

// One message, drawn again only when it changes: a streamed token changes the reply it belongs to, not the
// answers before it (their Markdown, maths and result rows)
const MessageRow = memo(function MessageRow({
  chatId,
  message,
  index,
  modelName,
  canRegenerate,
  broken,
  onEdit,
}: {
  chatId: string
  message: ChatMessage
  index: number
  modelName?: string
  canRegenerate: boolean
  // The chat's broken reply, which can be dismissed while it still asks for the user
  broken: boolean
  onEdit?: (text: string) => void
}) {
  const navigate = useNavigate()
  if (message.role === "user") return <UserMessage message={message} onEdit={onEdit} />
  return (
    <AssistantMessage
      chatId={chatId}
      message={message}
      modelName={modelName}
      onRegenerate={canRegenerate ? () => regenerate(chatId, index) : undefined}
      onDismiss={broken ? () => useSeenStore.getState().dismiss(chatId, message.id) : undefined}
      onSaveAsDoc={(markdown) => saveAnswerAsDoc(useChatStore.getState().chats[chatId]?.title ?? "", markdown, navigate)}
    />
  )
})
