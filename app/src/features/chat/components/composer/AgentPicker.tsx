import { CheckIcon, ChevronDownIcon, ShieldIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
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

export const isUnavailable = (c?: Connector) => !!c && (c.status === "not_installed" || c.status === "error")

// Resolves the agent, model, effort and mode in effect for a chat (or the global default)
export function useResolvedSelection(chatId?: string) {
  const connectors = useChatStore((s) => s.connectors)
  const globalSelection = useChatStore((s) => s.selection)
  const chat = useChatStore((s) => (chatId ? s.chats[chatId] : undefined))
  const setSelection = useChatStore((s) => s.setSelection)
  const setChatSelection = useChatStore((s) => s.setChatSelection)

  const selection: Selection = chat?.connectorId
    ? { connectorId: chat.connectorId, modelId: chat.modelId, modeId: chat.modeId, effortId: chat.effortId }
    : globalSelection
  const update = (patch: Partial<Selection>) => (chatId ? setChatSelection(chatId, patch) : setSelection(patch))

  const connector: Connector | undefined = connectors.find((c) => c.id === selection.connectorId) ?? connectors[0]
  const model = connector?.models.find((m) => m.id === selection.modelId) ?? connector?.models[0]
  const mode = connector?.modes.find((m) => m.id === selection.modeId) ?? connector?.modes[0]
  const effort =
    connector?.efforts?.find((e) => e.id === selection.effortId) ??
    connector?.efforts?.find((e) => e.id === connector.defaultEffortId) ??
    connector?.efforts?.[0]
  return { connectors, connector, model, mode, effort, update }
}

function PickerButton({ children, className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-7 gap-1 rounded-md px-2 font-normal text-muted-foreground hover:text-foreground data-open:bg-muted data-open:text-foreground", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="opacity-60" />
    </Button>
  )
}

// Title and description on the left, check on the right; roomy like a settings list
function RadioItem({
  checked,
  onSelect,
  title,
  description,
  trailing,
  muted,
}: {
  checked: boolean
  onSelect: () => void
  title: React.ReactNode
  description?: string
  // Small chip at the right edge, e.g. an agent's status
  trailing?: React.ReactNode
  muted?: boolean
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn("gap-3", muted && "text-muted-foreground")}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">{title}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      {/* Right edge holds the check or the trailing chip, so both line up flush right */}
      {checked ? <CheckIcon className="size-4 shrink-0" /> : trailing}
    </DropdownMenuItem>
  )
}

// Only states that need attention get a chip; a working agent stays quiet
function StatusChip({ c }: { c: Connector }) {
  if (c.status === "checking") return <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
  if (c.status === "not_installed" || c.status === "error") {
    return (
      <span
        title={c.status === "error" ? c.error : undefined}
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-xs leading-4",
          c.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {c.status === "error" ? "Error" : "Not installed"}
      </span>
    )
  }
  return null
}


// Three triggers: agent · model + effort · permission mode. Edits a chat's own
// selection when chatId is given, the global default otherwise.
export function AgentPicker({ chatId, className }: { chatId?: string; className?: string }) {
  const { connectors, connector, model, mode, effort, update } = useResolvedSelection(chatId)
  const openConnectors = useUiStore((s) => s.setConnectorsDialogOpen)
  const unavailable = isUnavailable(connector)

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PickerButton aria-label="Choose agent" className={cn(unavailable && "text-destructive hover:text-destructive")}>
            {connector?.status === "checking" && <Spinner className="size-3" />}
            {unavailable && <TriangleAlertIcon className="size-3.5" />}
            <span className="max-w-36 truncate">{connector?.name ?? "No agent"}</span>
          </PickerButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {connectors.map((c) => (
            <RadioItem
              key={c.id}
              checked={c.id === connector?.id}
              onSelect={() => update({ connectorId: c.id })}
              title={c.name}
              trailing={<StatusChip c={c} />}
              muted={isUnavailable(c)}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openConnectors(true)}>
            Manage agents…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {connector && connector.models.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PickerButton aria-label="Choose model and effort">
              {/* All three triggers share one tone; a dot separates the model from its effort */}
              <span className="max-w-32 truncate">{model?.name}</span>
              {effort && (
                <>
                  <span aria-hidden className="opacity-50">·</span>
                  <span className="max-w-24 truncate">{effort.name}</span>
                </>
              )}
            </PickerButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {connector.models.map((m) => (
              <RadioItem key={m.id} checked={m.id === model?.id} onSelect={() => update({ modelId: m.id })} title={m.name} />
            ))}
            {connector.efforts && connector.efforts.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <span className="flex-1">Effort</span>
                    <span className="text-muted-foreground">{effort?.name}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52" sideOffset={6}>
                    {connector.efforts.map((e) => (
                      <RadioItem key={e.id} checked={e.id === effort?.id} onSelect={() => update({ effortId: e.id })} title={e.name} />
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {connector && connector.modes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PickerButton aria-label="Choose permission mode">
              <ShieldIcon className="size-3.5" />
              <span className="max-w-32 truncate">{mode?.name}</span>
            </PickerButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {connector.modes.map((m) => (
              <RadioItem key={m.id} checked={m.id === mode?.id} onSelect={() => update({ modeId: m.id })} title={m.name} description={m.description} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
