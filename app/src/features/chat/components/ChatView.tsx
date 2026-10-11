import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { useAgentWindow } from "@/features/agent/store"
import { saveAnswerAsDoc } from "@/features/docs/save-as-doc"
import { useChatStore } from "../store"
import { pendingAsk, useBrokenReply, useLookAt } from "../status"
import { regenerate } from "../lib/regenerate"
import type { PromptInput } from "../types"
import { Composer, type ComposerHandle } from "./composer/Composer"
import { WaitingDock } from "./WaitingDock"
import { AssistantMessage, UserMessage } from "./messages/MessageItem"

// /chat/:chatId — message history with the composer docked at the bottom
export function ChatView() {
  const { chatId = "" } = useParams()
  const chat = useChatStore((s) => s.chats[chatId])
  const streaming = useChatStore((s) => !!s.streaming[chatId])
  const connectors = useChatStore((s) => s.connectors)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)
  const chatsLoaded = useChatStore((s) => s.chatsLoaded)
  const composer = useRef<ComposerHandle>(null)
  const navigate = useNavigate()
  useLookAt(chat ? chatId : null)
  // The chat on screen is the current one, so ⇧⌘J brings it beside another page
  const found = !!chat
  useEffect(() => {
    if (found) useAgentWindow.getState().follow(chatId)
  }, [found, chatId])
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
      {/* One scroller per chat, so switching chats opens the next one at its end */}
      <MessageScrollerProvider key={chat.id}>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="px-4" aria-label="Messages">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-1 py-6 pb-12">
              {/* Items sit directly in the content: the scroller only sees its direct children, so a wrapper
                  hides new messages from it and a sent question never moves to the top.
                  Items carry the spacing as bottom padding so the hover footers, which hang below each
                  message, stay inside the item's paint containment instead of being clipped. The latest
                  exchange always renders: skipped off screen, a just-sent question would be measured at its
                  placeholder height, and the scroller would anchor it a frame early and then jump */}
              {chat.messages.map((m, i) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"} className={cn("pb-7", i >= chat.messages.length - 2 && "[content-visibility:visible]")}>
                  {m.role === "user" ? (
                    <UserMessage message={m} onEdit={(text) => composer.current?.setText(text)} />
                  ) : (
                    <AssistantMessage
                      message={m}
                      modelName={modelName(m.connectorId, m.modelId)}
                      onRegenerate={!streaming ? () => regenerate(chat.id, i) : undefined}
                      onDismiss={broken?.messageId === m.id ? broken.dismiss : undefined}
                      onSaveAsDoc={(markdown) => saveAnswerAsDoc(chat.title, markdown, navigate)}
                    />
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* Floats above the text like a menu would: popover surface and a soft shadow */}
          <MessageScrollerButton className="bottom-6 bg-popover shadow-md" />
        </MessageScroller>
      </MessageScrollerProvider>
      {/* Messages fade out above the composer instead of running into it */}
      <div className="relative mx-auto w-full max-w-3xl px-4 pb-4">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <WaitingDock chat={chat} />
        <Composer ref={composer} chatId={chat.id} onSubmit={submit} streaming={streaming} waiting={streaming ? pendingAsk(chat)?.type : undefined} onCancel={() => cancel(chat.id)} />
      </div>
    </div>
  )
}
