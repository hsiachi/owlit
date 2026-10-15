import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAgentWindow } from "@/features/agent/store"
import { askSentence } from "./lib/step-words"
import { brokenReply, callOf, pendingAsk, useSeenStore } from "./status"
import { useChatStore } from "./store"
import { bridge } from "@/lib/rpc"

// Tells the system when a chat starts waiting on the user or breaks, so handed-off work reaches them while
// owlit is behind other windows; the desktop shell shows it only then. A chat that merely finished says
// nothing, as on the rail. Each thing is said once. Clicking it opens the chat, beside the page when the
// agent panel already shows it.
export function useChatNotifications() {
  const navigate = useNavigate()
  const said = useRef(new Set<string>())
  // Chats that ran a turn while owlit was open: only their breaking is news, not a reply that broke before
  const ran = useRef(new Set<string>())
  const dismissed = useSeenStore((s) => s.dismissed)
  // Where the chats that can say something stand, in one string, so this runs when one starts, stops, asks
  // or breaks rather than on every streamed token. Only a running chat asks, and only one that ran breaks
  // as news, so the others aren't read: this is worked out again with every token.
  const standing = useChatStore((s) =>
    [...new Set([...Object.keys(s.streaming), ...ran.current])]
      .flatMap((id) => {
        const c = s.chats[id]
        return c ? [`${id}:${s.streaming[id] ? `run:${pendingAsk(c)?.requestId ?? ""}` : (brokenReply(c, dismissed[id])?.id ?? "")}`] : []
      })
      .join(" "),
  )

  useEffect(() => {
    if (!bridge) return
    const { chats, streaming } = useChatStore.getState()
    for (const id of Object.keys(streaming)) ran.current.add(id)
    for (const chat of Object.values(chats)) {
      const ask = streaming[chat.id] ? pendingAsk(chat) : undefined
      const broken = streaming[chat.id] || !ran.current.has(chat.id) ? undefined : brokenReply(chat, dismissed[chat.id])
      const key = ask ? `${chat.id}:${ask.requestId}` : broken ? `${chat.id}:${broken.id}` : null
      if (!key || said.current.has(key)) continue
      said.current.add(key)
      const title = chat.title
      const where = t`In “${title}”`
      if (ask?.type === "permission") {
        bridge.notify({ title: askSentence(ask.title, callOf(chat, ask.toolCallId)), body: where, chatId: chat.id })
      } else if (ask?.type === "question") {
        bridge.notify({ title: t`Owlit has a question`, body: ask.questions[0]?.question ?? where, chatId: chat.id })
      } else if (broken) {
        const error = broken.error
        bridge.notify({ title: t`Owlit stopped`, body: error ? t`In “${title}”: ${error}` : where, chatId: chat.id })
      }
    }
  }, [standing, dismissed])

  useEffect(
    () =>
      bridge?.onNotificationClick((chatId) => {
        const panel = useAgentWindow.getState()
        if (panel.stage === "open" && panel.chatId === chatId) return
        navigate(`/chat/${chatId}`)
      }),
    [navigate],
  )
}
