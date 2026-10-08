import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpenIcon, FileTextIcon, NetworkIcon, PlugZapIcon, ScaleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useChatStore } from "../store"
import { useUiStore } from "../ui-store"
import type { PromptInput } from "../types"
import { Composer, type ComposerHandle } from "./composer/Composer"
import { StatusDot } from "./composer/AgentPicker"

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return "Up late"
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

const suggestions = [
  { icon: BookOpenIcon, label: "Summarize a paper", prompt: "Summarize the key contributions of " },
  { icon: ScaleIcon, label: "Compare two papers", prompt: "Compare the methods and findings of " },
  { icon: FileTextIcon, label: "Draft a note in Docs", prompt: "Write a short note into " },
  { icon: NetworkIcon, label: "Check a claim", prompt: "What evidence in the Library supports " },
]

// /chat with no conversation selected: greeting, composer, prompts, agent status
export function ChatEmpty() {
  const navigate = useNavigate()
  const createChat = useChatStore((s) => s.createChat)
  const send = useChatStore((s) => s.send)
  const connectors = useChatStore((s) => s.connectors)
  const selection = useChatStore((s) => s.selection)
  const openConnectors = useUiStore((s) => s.setConnectorsDialogOpen)
  const composer = useRef<ComposerHandle>(null)

  const connector = connectors.find((c) => c.id === selection.connectorId)
  const model = connector?.models.find((m) => m.id === selection.modelId)
  const ready = connector && (connector.status === "available" || connector.status === "connected")

  const start = (input: PromptInput) => {
    const chat = createChat()
    navigate(`/chat/${chat.id}`)
    void send(chat.id, input)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="font-heading text-3xl font-medium tracking-tight">{greeting()}</h1>
      <div className="w-full max-w-3xl">
        <Composer ref={composer} onSubmit={start} autoFocus />
      </div>
      <div className="flex max-w-3xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <Button key={s.label} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => composer.current?.setText(s.prompt)}>
            <s.icon />
            {s.label}
          </Button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => openConnectors(true)}
        className="mt-4 flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {connector ? (
          <>
            <StatusDot status={connector.status} />
            {ready ? (
              <>
                {connector.status === "connected" ? "Connected to" : "Ready:"} {connector.name}
                {model && ` · ${model.name}`}
              </>
            ) : connector.status === "checking" ? (
              `Checking ${connector.name}…`
            ) : connector.status === "unknown" ? (
              `${connector.name} not checked yet · Set up`
            ) : (
              `${connector.name} is not available · Set up`
            )}
          </>
        ) : (
          <>
            <PlugZapIcon className="size-3.5" />
            No local agent connected · Set up
          </>
        )}
      </button>
    </div>
  )
}
