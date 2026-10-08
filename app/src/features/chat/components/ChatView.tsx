import { useEffect, useRef } from "react"
import { Navigate, useParams } from "react-router-dom"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { MessageGroup } from "@/components/ui/message"
import { useChatStore } from "../store"
import type { PromptInput } from "../types"
import { Composer, type ComposerHandle } from "./composer/Composer"
import { AssistantMessage, UserMessage } from "./messages/MessageItem"

// /chat/:chatId — message history with the composer docked at the bottom
export function ChatView() {
  const { chatId = "" } = useParams()
  const chat = useChatStore((s) => s.chats[chatId])
  const streaming = useChatStore((s) => !!s.streaming[chatId])
  const connectors = useChatStore((s) => s.connectors)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)
  const respondPermission = useChatStore((s) => s.respondPermission)
  const composer = useRef<ComposerHandle>(null)

  useEffect(() => {
    composer.current?.focus()
  }, [chatId])

  if (!chat) return <Navigate to="/chat" replace />

  const modelName = (connectorId?: string, modelId?: string) =>
    connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name

  const submit = (input: PromptInput) => void send(chat.id, input)

  // Re-send the user message that precedes an assistant reply
  const regenerate = (index: number) => {
    const prev = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === "user")
    if (!prev) return
    const text = prev.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")
    void send(chat.id, { text, mentions: prev.mentions ?? [], attachments: prev.attachments ?? [] })
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-4" aria-label="Messages">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-8 py-6 pb-10">
              <MessageGroup className="gap-8">
                {chat.messages.map((m, i) => (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                    {m.role === "user" ? (
                      <UserMessage message={m} onEdit={(text) => composer.current?.setText(text)} />
                    ) : (
                      <AssistantMessage
                        message={m}
                        modelName={modelName(m.connectorId, m.modelId)}
                        onRespondPermission={(requestId, optionId) => respondPermission(chat.id, requestId, optionId)}
                        onRegenerate={!streaming ? () => regenerate(i) : undefined}
                      />
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageGroup>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Composer ref={composer} chatId={chat.id} onSubmit={submit} streaming={streaming} onCancel={() => cancel(chat.id)} />
      </div>
    </div>
  )
}
