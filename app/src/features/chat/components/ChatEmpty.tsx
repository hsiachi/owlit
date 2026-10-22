import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { keysFor } from "@/app/shortcuts"
import { useAgentWindow } from "@/features/agent/store"
import { useSettings } from "@/features/settings/store"
import { useChatStore } from "../store"
import type { PromptInput } from "@owlit/protocol"
import { CommandHint } from "./CommandHint"
import { type AskParts, Composer, type ComposerHandle } from "./composer/Composer"

// With the user's name when Settings has one; each greeting is one message, as the name's place varies
function greeting(name?: string) {
  const h = new Date().getHours()
  if (name) {
    if (h < 5) return t`Up late, ${name}`
    if (h < 12) return t`Good morning, ${name}`
    if (h < 18) return t`Good afternoon, ${name}`
    return t`Good evening, ${name}`
  }
  if (h < 5) return t`Up late`
  if (h < 12) return t`Good morning`
  if (h < 18) return t`Good afternoon`
  return t`Good evening`
}

// What a visit to /chat itself asks for: a starter handed over from elsewhere (the Library's Ask Owlit to
// find papers; Go through on a file, which names the file), or a fresh page (New chat, ⌘N, a deleted or
// missing chat)
export interface ChatIndexState {
  starter?: string | AskParts
  fresh?: boolean
  // The project the new chat is in from its first message (Home's "Where did I stop?"): a marked folder's path
  project?: string
}

export const FRESH_CHAT: ChatIndexState = { fresh: true }

// /chat with no conversation selected: greeting, composer, what "/" offers. Reached plainly (the rail's Chat
// button, a link), it goes back to the chat the person last looked at, as Docs goes back to the doc they
// were in: in a test, someone who left a running chat for the Library and came back by the rail landed on
// an empty page and thought the app had lost their chat. New chat and a page that sends a question to
// Chat say so in the route's state and get the empty page.
export function ChatEmpty() {
  const navigate = useNavigate()
  const createChat = useChatStore((s) => s.createChat)
  const send = useChatStore((s) => s.send)
  const chatsLoaded = useChatStore((s) => s.chatsLoaded)
  const composer = useRef<ComposerHandle>(null)
  // Settings › Owlit; without a name the greeting stands alone
  const name = useSettings((s) => s.view?.profile.name)
  const state = useLocation().state as ChatIndexState | null
  const starter = state?.starter
  const lastChatId = useAgentWindow((s) => s.chatId)
  const lastChat = useChatStore((s) => (lastChatId ? s.chats[lastChatId] : undefined))
  const keys = keysFor("owlit")

  useEffect(() => {
    if (typeof starter === "string") composer.current?.setText(starter)
    else if (starter) composer.current?.setAsk(starter)
  }, [starter])

  if (!starter && !state?.fresh && lastChatId) {
    if (lastChat) return <Navigate to={`/chat/${lastChat.id}`} replace />
    // The chats are still being read; a chat that is gone falls through to the empty page
    if (!chatsLoaded) return null
  }

  // The composer names the new chat's id: files attached before sending are already in its folder
  const start = (input: PromptInput, id: string) => {
    const chat = createChat({ id })
    // Before the send, so the first turn already hears the project's lines
    if (state?.project) useChatStore.getState().setChatProject(chat.id, state.project)
    navigate(`/chat/${chat.id}`)
    void send(chat.id, input)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      {/* Set like the wordmark: Dosis has no italic, so the 12° slant is drawn with a skew. Chinese is never
          slanted (it reads as a faux italic), so in Chinese the greeting stands upright */}
      <h1 className="font-display max-w-3xl -skew-x-12 text-center [&:lang(zh)]:skew-x-0 text-[2.75rem] leading-none font-medium text-balance text-foreground/90">
        {greeting(name)}
      </h1>
      <div data-tour="composer" className="w-full max-w-3xl">
        <Composer ref={composer} onSubmit={start} autoFocus />
      </div>
      <CommandHint className="-mt-2 text-center" />
      <p className="-mt-5 text-detail text-muted-foreground">{t`From anywhere, ${keys} asks Owlit about what’s on your screen.`}</p>
    </div>
  )
}
