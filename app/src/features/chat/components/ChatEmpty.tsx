import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { keysFor } from "@/app/shortcuts"
import { Button } from "@/components/ui/button"
import { useSettings } from "@/features/settings/store"
import { useChatStore } from "../store"
import type { PromptInput } from "../types"
import { starters } from "../lib/starters"
import { Composer, type ComposerHandle } from "./composer/Composer"

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return "Up late"
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

// /chat with no conversation selected: greeting, composer, starter prompts
export function ChatEmpty() {
  const navigate = useNavigate()
  const createChat = useChatStore((s) => s.createChat)
  const send = useChatStore((s) => s.send)
  const composer = useRef<ComposerHandle>(null)
  // Settings › Owlit; without a name the greeting stands alone
  const name = useSettings((s) => s.view?.profile.name)
  // A starter handed over from elsewhere (the Library's Ask Owlit to find papers)
  const starter = (useLocation().state as { starter?: string } | null)?.starter

  useEffect(() => {
    if (starter) composer.current?.setText(starter)
  }, [starter])

  // The composer names the new chat's id: files attached before sending are already in its folder
  const start = (input: PromptInput, id: string) => {
    const chat = createChat({ id })
    navigate(`/chat/${chat.id}`)
    void send(chat.id, input)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      {/* Set like the wordmark: Dosis has no italic, so the 12° slant is drawn with a skew */}
      <h1 className="font-display max-w-3xl -skew-x-12 text-center text-[2.75rem] leading-none font-medium text-balance text-foreground/90">
        {name ? `${greeting()}, ${name}` : greeting()}
      </h1>
      <div className="w-full max-w-3xl">
        <Composer ref={composer} onSubmit={start} autoFocus />
      </div>
      <div className="flex max-w-3xl flex-wrap justify-center gap-2">
        {/* Words only on a translucent fill: no outline to stack against the composer's border */}
        {starters.map((s) => (
          <Button
            key={s.label}
            variant="secondary"
            size="sm"
            className="rounded-full px-3 font-normal text-muted-foreground hover:text-foreground"
            onClick={() => {
              composer.current?.setText(s.prompt)
              if (s.kind) composer.current?.openMention(s.kind)
            }}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <p className="-mt-2 text-detail text-muted-foreground">From anywhere, {keysFor("owlit")} asks Owlit about what’s on your screen.</p>
    </div>
  )
}
