import { Fragment } from "react"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"
import { DEFAULT_ROLE, ROLES } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tip } from "@/components/tip"
import { AgentIcon } from "./agent-icons"
import { isUnavailable, statusLabel } from "../../lib/connector-status"
import { ConnectorStatusChip } from "../ConnectorStatusChip"
import { useChatStore, type Selection } from "../../store"
import { openSettings } from "@/features/settings/store"
import type { Connector } from "../../types"

// Resolves the agent, model, effort and role in effect for a chat (or the global default)
export function useResolvedSelection(chatId?: string) {
  const connectors = useChatStore((s) => s.connectors)
  const globalSelection = useChatStore((s) => s.selection)
  const chat = useChatStore((s) => (chatId ? s.chats[chatId] : undefined))
  const setSelection = useChatStore((s) => s.setSelection)
  const setChatSelection = useChatStore((s) => s.setChatSelection)

  const selection: Selection = chat?.connectorId
    ? { connectorId: chat.connectorId, modelId: chat.modelId, role: chat.role ?? globalSelection.role, effortId: chat.effortId }
    : globalSelection
  const update = (patch: Partial<Selection>) => (chatId ? setChatSelection(chatId, patch) : setSelection(patch))

  const connector: Connector | undefined = connectors.find((c) => c.id === selection.connectorId) ?? connectors[0]
  const model =
    connector?.models.find((m) => m.id === selection.modelId) ??
    connector?.models.find((m) => m.id === connector.defaultModelId) ??
    connector?.models[0]
  const role = ROLES.find((r) => r.id === selection.role) ?? ROLES.find((r) => r.id === DEFAULT_ROLE)!
  const effort =
    connector?.efforts?.find((e) => e.id === selection.effortId) ??
    connector?.efforts?.find((e) => e.id === connector.defaultEffortId) ??
    connector?.efforts?.[0]
  return { connectors, connector, model, role, effort, update }
}

// A compact trigger: no chevron (a menu opens from each), a tooltip naming what it sets. Radix needs the
// tooltip and menu triggers stacked on the same button.
function PickerButton({ tip, children, className, ...props }: React.ComponentProps<typeof Button> & { tip: React.ReactNode }) {
  return (
    <Tip label={tip}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 min-w-0 gap-1 rounded-md px-1.5 font-normal text-muted-foreground hover:text-foreground data-open:bg-muted data-open:text-foreground", className)}
          {...props}
        >
          {children}
        </Button>
      </DropdownMenuTrigger>
    </Tip>
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



// Three triggers: agent · model + effort · Owlit's role. Edits a chat's own
// selection when chatId is given, the global default otherwise.
export function AgentPicker({ chatId, className }: { chatId?: string; className?: string }) {
  const { connectors, connector, model, role, effort, update } = useResolvedSelection(chatId)
  const unavailable = isUnavailable(connector)

  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      {/* The agent shows as its mark alone; its name is in the tooltip and the menu. A state that needs
          the user takes the mark's place, so it reads at a glance. */}
      <DropdownMenu>
        <PickerButton
          aria-label={`Agent: ${connector?.name ?? "none"}`}
          tip={connector ? (unavailable || connector.status === "checking" ? `${connector.name} · ${statusLabel[connector.status]}` : connector.name) : "No agent"}
          className={cn("w-7 justify-center px-0", unavailable && "text-destructive hover:text-destructive")}
        >
          {connector?.status === "checking" ? <Spinner className="size-3.5" /> : unavailable ? <TriangleAlertIcon className="size-4" /> : <AgentIcon id={connector?.id} />}
        </PickerButton>
        <DropdownMenuContent align="end" className="w-56">
          {connectors.map((c) => (
            <RadioItem
              key={c.id}
              checked={c.id === connector?.id}
              onSelect={() => update({ connectorId: c.id })}
              title={
                <>
                  <AgentIcon id={c.id} className="size-3.5 text-muted-foreground" />
                  {c.name}
                </>
              }
              trailing={c.status === "checking" ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : <ConnectorStatusChip c={c} />}
              muted={isUnavailable(c)}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSettings("agents")}>
            Manage agents…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {connector && connector.models.length > 0 && (
        <DropdownMenu>
          {/* The model is a step darker than the effort after it, so the two read apart without a separator
              and the effort keeps the muted tone's contrast (a fainter effort fell under 3:1). Below a 304px
              composer (the agent panel at its narrowest) the effort leaves the trigger and stays in the
              tooltip and the menu. */}
          <PickerButton aria-label="Choose model and effort" tip={effort ? `${model?.name} · ${effort.name} effort` : model?.name} className="group/model">
            <span className="min-w-0 truncate text-foreground/80 group-hover/model:text-foreground group-data-open/model:text-foreground">{model?.name}</span>
            {effort && <span className="shrink-0 @max-[19rem]:hidden">{effort.name}</span>}
          </PickerButton>
          <DropdownMenuContent align="end" className="w-52">
            {/* An agent that groups its models (the Owlit engine, by provider) gets a heading per group,
                so the same kind of model from two sign-ins reads apart */}
            {connector.models.map((m, i) => (
              <Fragment key={m.id}>
                {m.group && m.group !== connector.models[i - 1]?.group && <DropdownMenuLabel>{m.group}</DropdownMenuLabel>}
                <RadioItem checked={m.id === model?.id} onSelect={() => update({ modelId: m.id })} title={m.name} />
              </Fragment>
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

      {/* The role is Owlit's own, not the agent's: every agent offers the same three. Named in full even
          in a narrow composer, since a role reads as its name. */}
      <DropdownMenu>
        <PickerButton aria-label="Choose how Owlit works" tip={role.description} className="shrink-0">
          {role.name}
        </PickerButton>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Owlit works as</DropdownMenuLabel>
          {ROLES.map((r) => (
            <RadioItem key={r.id} checked={r.id === role.id} onSelect={() => update({ role: r.id })} title={r.name} description={r.description} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
