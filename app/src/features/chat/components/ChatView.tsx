import { useCallback, useEffect, useRef, useState } from "react"
import { Navigate, useParams } from "react-router-dom"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "../store"
import { useLookAt } from "../status"
import type { ComposerHandle } from "./composer/Composer"
import { ChatMessages } from "./ChatMessages"
import { ComposerDock } from "./ComposerDock"
import { FRESH_CHAT } from "./ChatEmpty"
import { useTakeParam } from "@/hooks/use-take-param"
import { useProjects } from "@/features/projects/store"
import { ProjectChip } from "./composer/ProjectChip"

// /chat/:chatId — message history with the composer docked at the bottom
export function ChatView() {
  const { chatId = "" } = useParams()
  const chat = useChatStore((s) => s.chats[chatId])
  const streaming = useChatStore((s) => !!s.streaming[chatId])
  const chatsLoaded = useChatStore((s) => s.chatsLoaded)
  const anyProject = useProjects().length > 0
  const composer = useRef<ComposerHandle>(null)
  useLookAt(chat ? chatId : null)
  // The chat on screen is the current one, so ⇧⌘J brings it beside another page
  const found = !!chat
  useEffect(() => {
    if (found) useAgentWindow.getState().follow(chatId)
  }, [found, chatId])

  useEffect(() => {
    composer.current?.focus()
  }, [chatId])

  const edit = useCallback((text: string) => composer.current?.setText(text), [])

  // Opened at one answer (?message=, from Owlit's mark in a paper): the scroller brings it up, waiting for
  // it to be drawn when the chat's messages are still loading
  const [seek, setSeek] = useState<string | null>(null)
  useTakeParam("message", setSeek, { enabled: found })
  const sought = useCallback(() => setSeek(null), [])

  // A chat the workspace hasn't listed yet may still turn up (a reload of this page)
  if (!chat) return chatsLoaded ? <Navigate to="/chat" state={FRESH_CHAT} replace /> : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ChatMessages chat={chat} streaming={streaming} onEdit={edit} seek={seek ?? undefined} onSought={sought} />
      <ComposerDock
        ref={composer}
        chat={chat}
        streaming={streaming}
        onSubmit={(input) => void useChatStore.getState().send(chat.id, input)}
        header={anyProject ? <ProjectChip chat={chat} /> : undefined}
      />
    </div>
  )
}
