import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpenIcon, FileTextIcon, NetworkIcon, ScaleIcon } from "lucide-react"
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

// Each starter fills a prompt stem and opens the mention popup on the source it needs
const suggestions: { icon: typeof BookOpenIcon; label: string; prompt: string; kind: SourceKind | "all" }[] = [
  { icon: BookOpenIcon, label: "Summarize a paper", prompt: "Summarize the key contributions of ", kind: "paper" },
  { icon: ScaleIcon, label: "Compare two papers", prompt: "Compare the methods and findings of ", kind: "paper" },
  { icon: FileTextIcon, label: "Draft a note in Docs", prompt: "Write a short note into ", kind: "doc" },
  { icon: NetworkIcon, label: "Check a claim", prompt: "What evidence in the Library supports ", kind: "knowledge" },
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
        {suggestions.map((s) => (
          <Button
            key={s.label}
            variant="outline"
            size="sm"
            className="rounded-full font-normal text-muted-foreground"
            onClick={() => {
              composer.current?.setText(s.prompt)
              composer.current?.openMention(s.kind)
            }}
          >
            <s.icon />
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
