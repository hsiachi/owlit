import { CheckIcon, ChevronDownIcon, SettingsIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useChatStore, type Selection } from "../../store"
import { useUiStore } from "../../ui-store"
import type { Connector, ConnectorStatus } from "../../types"

export const statusLabel: Record<ConnectorStatus, string> = {
  unknown: "Not checked",
  checking: "Checking…",
  not_installed: "Not installed",
  available: "Ready",
  connected: "Connected",
  error: "Error",
}

export function StatusDot({ status, className }: { status: ConnectorStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "available" && "bg-emerald-500/50",
        status === "checking" && "animate-pulse bg-amber-500",
        (status === "not_installed" || status === "error") && "bg-destructive",
        status === "unknown" && "bg-muted-foreground/40",
        className,
      )}
    />
  )
}

function PickerButton({ children, className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-7 gap-1 px-2 font-normal text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="opacity-60" />
    </Button>
  )
}

function RadioItem({ checked, onSelect, title, description }: { checked: boolean; onSelect: () => void; title: React.ReactNode; description?: string }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-2 py-1.5">
      <CheckIcon className={cn("mt-0.5 size-3.5", !checked && "invisible")} />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">{title}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
    </DropdownMenuItem>
  )
}

// Agent · Model · Mode. Edits a chat's own selection when chatId is given, the
// global default otherwise.
export function AgentPicker({ chatId, className }: { chatId?: string; className?: string }) {
  const connectors = useChatStore((s) => s.connectors)
  const globalSelection = useChatStore((s) => s.selection)
  const chat = useChatStore((s) => (chatId ? s.chats[chatId] : undefined))
  const setSelection = useChatStore((s) => s.setSelection)
  const setChatSelection = useChatStore((s) => s.setChatSelection)
  const openConnectors = useUiStore((s) => s.setConnectorsDialogOpen)

  const selection: Selection = chat?.connectorId
    ? { connectorId: chat.connectorId, modelId: chat.modelId, modeId: chat.modeId }
    : globalSelection
  const update = (patch: Partial<Selection>) => (chatId ? setChatSelection(chatId, patch) : setSelection(patch))

  const connector: Connector | undefined = connectors.find((c) => c.id === selection.connectorId) ?? connectors[0]
  const model = connector?.models.find((m) => m.id === selection.modelId) ?? connector?.models[0]
  const mode = connector?.modes.find((m) => m.id === selection.modeId) ?? connector?.modes[0]

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PickerButton aria-label="Choose agent">
            {connector && <StatusDot status={connector.status} />}
            <span className="max-w-32 truncate">{connector?.name ?? "No agent"}</span>
          </PickerButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Local agents</DropdownMenuLabel>
          {connectors.map((c) => (
            <RadioItem
              key={c.id}
              checked={c.id === connector?.id}
              onSelect={() => update({ connectorId: c.id })}
              title={
                <>
                  <StatusDot status={c.status} />
                  {c.name}
                </>
              }
              description={c.status === "error" ? (c.error ?? statusLabel.error) : statusLabel[c.status]}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openConnectors(true)}>
            <SettingsIcon />
            Manage connectors…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {connector && connector.models.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PickerButton aria-label="Choose model">
              <span className="max-w-32 truncate">{model?.name}</span>
            </PickerButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {connector.models.map((m) => (
              <RadioItem key={m.id} checked={m.id === model?.id} onSelect={() => update({ modelId: m.id })} title={m.name} description={m.description} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {connector && connector.modes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PickerButton aria-label="Choose mode">
              <span className="max-w-32 truncate">{mode?.name}</span>
            </PickerButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {connector.modes.map((m) => (
              <RadioItem key={m.id} checked={m.id === mode?.id} onSelect={() => update({ modeId: m.id })} title={m.name} description={m.description} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
