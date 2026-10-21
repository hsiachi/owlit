import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef } from "react"
import { useLocation } from "react-router-dom"
import { Kbd } from "@/components/ui/kbd"
import { Tip } from "@/components/tip"
import { keysFor } from "@/app/shortcuts"
import { Composer, type ComposerHandle } from "@/features/chat/components/composer/Composer"
import { useChatStore } from "@/features/chat/store"
import { SelectionChip } from "./ContextChips"
import { useAgentAllowed } from "./hooks"
import { askAboutHint, useVisibleContext } from "./page-context"
import { pageUri } from "./page-uri"
import { panelChatFor, useAgentWindow } from "./store"

// A small bar at the bottom of the page for the first question; sending it opens the panel. It is the
// chat's own composer in one line, so what is typed waits in the new chat's draft (Esc keeps it), and
// mentions, files, the agent and role pickers and the keys work as in every other composer.
export function AgentAskBar() {
  const allowed = useAgentAllowed()
  const stage = useAgentWindow((s) => s.stage)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
  const hint = useAgentWindow((s) => s.hint)
  // The chat ⇧⌘J would bring back (the store's panelChatFor), offered while the bar is empty so the way
  // back is never a guess. Its title is in the tooltip, not the bar: an unrelated chat's title read as
  // part of this page's question.
  const page = pageUri(useLocation().pathname)
  const chatId = useAgentWindow((s) => s.chatId)
  const chats = useChatStore((s) => s.chats)
  const current = useMemo(() => {
    const id = panelChatFor(page)
    const chat = id ? chats[id] : undefined
    return chat?.messages.length ? chat.title : null
    // panelChatFor reads the current chat and the chats; the deps are what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, chatId, chats])
  const context = useVisibleContext()
  const composer = useRef<ComposerHandle>(null)

  useEffect(() => {
    if (stage === "bar") composer.current?.focus()
  }, [stage, focusTick])

  if (!allowed || stage !== "bar") return null

  return (
    <>
      {/* The page's text fades out under the bar instead of running behind it */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-linear-to-t from-background from-40% to-transparent" />
      <div className="absolute bottom-4 left-1/2 z-20 w-[min(600px,calc(100%-48px))] -translate-x-1/2">
        <Composer
          ref={composer}
          bar
          autoFocus
          className="shadow-md"
          placeholder={hint ?? (context[0] ? askAboutHint(context[0].kind) : t`Ask Owlit…`)}
          onSubmit={(input, id) => useAgentWindow.getState().send(input, context, id)}
          onEscape={() => useAgentWindow.getState().close()}
          header={selection ? <SelectionChip selection={selection} length={24} /> : undefined}
          idle={
            current &&
            !selection && (
              <Tip label={current} side="top">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => useAgentWindow.getState().togglePanel()}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Kbd>{keysFor("owlit-panel")}</Kbd>
                  {t`Last chat`}
                </button>
              </Tip>
            )
          }
        />
      </div>
    </>
  )
}
