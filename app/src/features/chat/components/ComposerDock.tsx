import { cn } from "@/lib/utils"
import { useChatStore } from "../store"
import { pendingAsk } from "../status"
import type { Chat } from "../types"
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
  return (
    <div className={panel ? "relative shrink-0 px-3 pb-3" : "relative mx-auto w-full max-w-3xl px-4 pb-4"}>
      {/* Messages fade out above the composer instead of running into it */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bg-gradient-to-t to-transparent", panel ? "-top-6 h-6 from-sidebar-panel" : "-top-8 h-8 from-background")} />
      {chat && <WaitingDock chat={chat} compact={compact} />}
      <Composer
        ref={ref}
        chatId={chat?.id}
        streaming={streaming}
        waiting={chat && streaming ? pendingAsk(chat)?.type : undefined}
        onCancel={() => chat && useChatStore.getState().cancel(chat.id)}
        {...props}
      />
    </div>
  )
}
