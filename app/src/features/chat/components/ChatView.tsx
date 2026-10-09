import { useEffect, useRef } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { MessageGroup } from "@/components/ui/message"
import { saveAnswerAsDoc } from "@/features/docs/save-as-doc"
import { useChatStore } from "../store"
import { useBrokenReply, useLookAt } from "../status"
import { regenerate } from "../lib/regenerate"
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
  const chatsLoaded = useChatStore((s) => s.chatsLoaded)
  const composer = useRef<ComposerHandle>(null)
  const navigate = useNavigate()
  useLookAt(chat ? chatId : null)
  const broken = useBrokenReply(chat)

  useEffect(() => {
    composer.current?.focus()
  }, [chatId])

  // A chat the workspace hasn't listed yet may still turn up (a reload of this page)
  if (!chat) return chatsLoaded ? <Navigate to="/chat" replace /> : null

  const modelName = (connectorId?: string, modelId?: string) =>
    connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name

  const submit = (input: PromptInput) => void send(chat.id, input)


  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-4" aria-label="Messages">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-8 py-6 pb-12">
              {/* Items carry the spacing as bottom padding so the hover footers, which hang below each
                  message, stay inside the item's paint containment instead of being clipped */}
              <MessageGroup className="gap-1">
                {chat.messages.map((m, i) => (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"} className="pb-7">
                    {m.role === "user" ? (
                      <UserMessage message={m} onEdit={(text) => composer.current?.setText(text)} />
                    ) : (
                      <AssistantMessage
                        message={m}
                        modelName={modelName(m.connectorId, m.modelId)}
                        onRespondPermission={(requestId, optionId) => respondPermission(chat.id, requestId, optionId)}
                        onRegenerate={!streaming ? () => regenerate(chat.id, i) : undefined}
                        onDismiss={broken?.messageId === m.id ? broken.dismiss : undefined}
                        onSaveAsDoc={(markdown) => saveAnswerAsDoc(chat.title, markdown, navigate)}
                      />
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageGroup>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* Floats above the text like a menu would: popover surface and a soft shadow */}
          <MessageScrollerButton className="bottom-6 bg-popover shadow-md" />
        </MessageScroller>
      </MessageScrollerProvider>
      {/* Messages fade out above the composer instead of running into it */}
      <div className="relative mx-auto w-full max-w-3xl px-4 pb-4">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <Composer ref={composer} chatId={chat.id} onSubmit={submit} streaming={streaming} onCancel={() => cancel(chat.id)} />
      </div>
    </div>
  )
}
