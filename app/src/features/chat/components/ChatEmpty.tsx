import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useChatStore } from "../store"
import type { PromptInput, SourceKind } from "../types"
import { Composer, type ComposerHandle } from "./composer/Composer"

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return "Up late"
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

// The Chat page is where work is handed off (a quick question goes through the agent window, ⌘J), so the
// starters are jobs that take a few minutes. Each fills a prompt stem; where it needs a paper or doc, the
// mention popup opens on that kind.
const suggestions: { label: string; prompt: string; kind?: SourceKind | "all" }[] = [
  { label: "Find papers and add them", prompt: "Find recent papers on " },
  { label: "Compare papers", prompt: "Compare the methods and findings of ", kind: "paper" },
  { label: "Review a draft", prompt: "Review where I overstate a finding or misread a paper in ", kind: "doc" },
  { label: "Ask about your papers", prompt: "What do my papers say about " },
]

// /chat with no conversation selected: greeting, composer, starter prompts
export function ChatEmpty() {
  const navigate = useNavigate()
  const createChat = useChatStore((s) => s.createChat)
  const send = useChatStore((s) => s.send)
  const composer = useRef<ComposerHandle>(null)

  const start = (input: PromptInput) => {
    const chat = createChat()
    navigate(`/chat/${chat.id}`)
    void send(chat.id, input)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="font-display text-[2.75rem] leading-none font-normal tracking-tight text-foreground/90">{greeting()}</h1>
      <div className="w-full max-w-3xl">
        <Composer ref={composer} onSubmit={start} autoFocus />
      </div>
      <div className="flex max-w-3xl flex-wrap justify-center gap-2">
        {/* Words only on a translucent fill: no outline to stack against the composer's border */}
        {suggestions.map((s) => (
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
    </div>
  )
}
