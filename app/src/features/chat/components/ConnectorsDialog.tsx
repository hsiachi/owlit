import { useState } from "react"
import { CopyIcon, InfoIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useChatStore } from "../store"
import { useUiStore } from "../ui-store"
import type { Connector } from "../types"

const ABOUT =
  "Coding agents installed on this machine, driven over the Agent Client Protocol. Each agent uses its own sign-in; owlit stores no keys."

// An icon button whose label lives in a tooltip
function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// Ready: just the version, quietly. Not installed: a neutral chip. Error: a red chip.
function Status({ c }: { c: Connector }) {
  if (c.status === "available" || c.status === "connected") {
    return c.version && c.version !== "unknown" ? <span className="text-xs text-muted-foreground">v{c.version}</span> : null
  }
  if (c.status === "not_installed" || c.status === "error") {
    return (
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-xs leading-4",
          c.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {c.status === "error" ? "Error" : "Not installed"}
      </span>
    )
  }
  return null
}

function ConnectorRow({ connector: c }: { connector: Connector }) {
  const check = useChatStore((s) => s.checkConnector)
  const remove = useChatStore((s) => s.removeConnector)
  const busy = c.status === "checking"
  const unavailable = c.status === "not_installed" || c.status === "error"

  const copyInstall = () => {
    if (!c.installHint) return
    void navigator.clipboard.writeText(c.installHint)
    toast("Install command copied", { description: c.installHint })
  }

  return (
    <li className="flex min-h-12 items-center gap-3 py-1.5 pr-1.5 pl-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-medium", unavailable && "text-muted-foreground")}>{c.name}</span>
          <Status c={c} />
        </div>
        {/* Only problems and user-entered commands earn a second line. A missing agent shows the
            command that fixes it, since that's the one thing the user needs here. */}
        {c.status === "error" && c.error && <div className="mt-0.5 truncate text-[13px] text-destructive">{c.error}</div>}
        {c.status === "not_installed" && c.installHint && (
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={c.installHint}>
            {c.installHint}
          </div>
        )}
        {!c.builtIn && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{c.command}</div>}
      </div>
      <div className="flex shrink-0 items-center">
        {c.status === "not_installed" && c.installHint && (
          <IconAction label="Copy install command" onClick={copyInstall}>
            <CopyIcon />
          </IconAction>
        )}
        <IconAction label={c.status === "unknown" ? "Check" : "Re-check"} onClick={() => check(c.id)} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCwIcon />}
        </IconAction>
        {!c.builtIn && (
          <IconAction label={`Remove ${c.name}`} onClick={() => remove(c.id)}>
            <Trash2Icon />
          </IconAction>
        )}
      </div>
    </li>
  )
}

// The custom-agent form stays folded until asked for. Open state lives in the dialog so Esc can
// fold the form first (Radix handles Esc at the document level, before any onKeyDown here).
function AddAgent({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const addCustom = useChatStore((s) => s.addCustomConnector)
  const check = useChatStore((s) => s.checkConnector)
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")

  const close = () => {
    setOpen(false)
    setName("")
    setCommand("")
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="-ml-2 justify-self-start font-normal text-muted-foreground" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add ACP agent
      </Button>
    )
  }

  return (
    <form
      className="flex flex-col gap-3.5 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!command.trim()) return
        void addCustom(name, command).then((c) => check(c.id))
        close()
      }}
    >
      <div className="text-sm font-medium">Add ACP agent</div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input autoFocus placeholder="My agent" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Command</span>
        <Input placeholder="my-agent --acp" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono text-[13px]" />
        <span className="text-xs text-muted-foreground">What owlit runs to start the agent. It must speak ACP over stdio.</span>
      </label>
      <div className="flex justify-end gap-2 pt-0.5">
        <Button type="button" variant="ghost" className="text-muted-foreground" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={!command.trim()}>
          Add agent
        </Button>
      </div>
    </form>
  )
}

// The local agents owlit can drive: status at a glance, actions as icons, explanations on demand
export function ConnectorsDialog() {
  const open = useUiStore((s) => s.connectorsDialogOpen)
  const setOpen = useUiStore((s) => s.setConnectorsDialogOpen)
  const connectors = useChatStore((s) => s.connectors)
  const [adding, setAdding] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setAdding(false)
      }}
    >
      <DialogContent
        className="gap-4 sm:max-w-lg"
        // Focus the dialog itself rather than its first button, so the info tooltip doesn't pop open on arrival
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
        // Esc folds an open add form before it closes the dialog
        onEscapeKeyDown={(e) => {
          if (adding) {
            e.preventDefault()
            setAdding(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            Local agents
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50" aria-label="About local agents">
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                {ABOUT}
              </TooltipContent>
            </Tooltip>
          </DialogTitle>
          <DialogDescription className="sr-only">{ABOUT}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border text-sm">
          {connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </ul>
        <AddAgent open={adding} setOpen={setAdding} />
      </DialogContent>
    </Dialog>
  )
}
