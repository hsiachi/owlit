import { useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { useChatStore } from "../store"
import { pendingAsk } from "../status"
import type { Chat } from "@owlit/protocol"
import { Composer, type ComposerHandle, type ComposerProps } from "./composer/Composer"
import { WaitingDock } from "./WaitingDock"

// The composer at the foot of a chat, with what the chat waits on the user for above it; on the Chat page
// or in the docked agent panel (`panel`), where a narrow panel drops the waiting card's hint (`compact`)
export function ComposerDock({
  chat,
  streaming,
  panel = false,
  compact,
  ref,
  ...props
}: Omit<ComposerProps, "chatId" | "streaming" | "waiting" | "onCancel"> & {
  chat: Chat | undefined
  streaming: boolean
  panel?: boolean
  compact?: boolean
  ref?: React.Ref<ComposerHandle>
}) {
  // The dock keeps its own handle on the composer, so a card above it can hand the keyboard over
  const handle = useRef<ComposerHandle | null>(null)
  const setHandle = useCallback(
    (h: ComposerHandle | null) => {
      handle.current = h
      if (typeof ref === "function") ref(h)
      else if (ref) ref.current = h
    },
    [ref],
  )
  return (
    <div className={panel ? "relative shrink-0 px-3 pb-3" : "relative mx-auto w-full max-w-3xl px-4 pb-4"}>
      {/* Messages fade out above the composer instead of running into it. Not in an empty chat, where nothing
          scrolls under it and the fade would only dim the empty state's last line. */}
      {!!chat?.messages.length && (
        <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bg-gradient-to-t to-transparent", panel ? "-top-6 h-6 from-sidebar-panel" : "-top-8 h-8 from-background")} />
      )}
      {chat && <WaitingDock chat={chat} compact={compact} onTypeInstead={() => handle.current?.focus()} />}
      <Composer
        ref={setHandle}
        chatId={chat?.id}
        streaming={streaming}
        waiting={chat && streaming ? pendingAsk(chat)?.type : undefined}
        onCancel={() => chat && useChatStore.getState().cancel(chat.id)}
        {...props}
      />
    </div>
  )
}
