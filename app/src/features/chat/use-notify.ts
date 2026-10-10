import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAgentWindow } from "@/features/agent/store"
import { askSentence, type ToolCall } from "./lib/step-words"
import { brokenReply, pendingAsk, useSeenStore } from "./status"
import { useChatStore } from "./store"

// Tells the system when a chat starts waiting on the user or breaks, so handed-off work reaches them while
// owlit is behind other windows; the desktop shell shows it only then. A chat that merely finished says
// nothing, as on the rail. Each thing is said once. Clicking it opens the chat, beside the page when the
// agent panel already shows it.
export function useChatNotifications() {
  const navigate = useNavigate()
  const said = useRef(new Set<string>())
  // Chats that ran a turn while owlit was open: only their breaking is news, not a reply that broke before
  const ran = useRef(new Set<string>())
  const chats = useChatStore((s) => s.chats)
  const streaming = useChatStore((s) => s.streaming)
  const dismissed = useSeenStore((s) => s.dismissed)

  useEffect(() => {
    const bridge = window.owlit
    if (!bridge) return
    for (const id of Object.keys(streaming)) ran.current.add(id)
    for (const chat of Object.values(chats)) {
      const ask = streaming[chat.id] ? pendingAsk(chat) : undefined
      const broken = streaming[chat.id] || !ran.current.has(chat.id) ? undefined : brokenReply(chat, dismissed[chat.id])
      const key = ask ? `${chat.id}:${ask.requestId}` : broken ? `${chat.id}:${broken.id}` : null
      if (!key || said.current.has(key)) continue
      said.current.add(key)
      const where = `In “${chat.title}”`
      if (ask?.type === "permission") {
        const call = chat.messages.at(-1)?.parts.find((p): p is ToolCall => p.type === "tool_call" && p.toolCallId === ask.toolCallId)
        bridge.notify({ title: askSentence(ask.title, call), body: where, chatId: chat.id })
      } else if (ask?.type === "question") {
        bridge.notify({ title: "Owlit has a question", body: ask.questions[0]?.question ?? where, chatId: chat.id })
      } else if (broken) {
        bridge.notify({ title: "Owlit stopped", body: broken.error ? `${where}: ${broken.error}` : where, chatId: chat.id })
      }
    }
  }, [chats, streaming, dismissed])

  useEffect(
    () =>
      window.owlit?.onNotificationClick((chatId) => {
        const panel = useAgentWindow.getState()
        if (panel.stage === "open" && panel.chatId === chatId) return
        navigate(`/chat/${chatId}`)
      }),
    [navigate],
  )
}
