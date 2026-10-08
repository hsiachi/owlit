import { useState } from "react"
import { PlugIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { useChatStore } from "../store"
import { useUiStore } from "../ui-store"
import type { Connector } from "../types"
import { StatusDot, statusLabel } from "./composer/AgentPicker"

function ConnectorRow({ connector }: { connector: Connector }) {
  const check = useChatStore((s) => s.checkConnector)
  const remove = useChatStore((s) => s.removeConnector)
  const c = connector
  const busy = c.status === "checking"
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <PlugIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2">
          {c.name}
          <Badge variant={c.status === "error" || c.status === "not_installed" ? "destructive" : "secondary"} className="gap-1.5">
            <StatusDot status={c.status} />
            {statusLabel[c.status]}
            {c.version && c.version !== "unknown" && ` · v${c.version}`}
          </Badge>
        </ItemTitle>
        <ItemDescription className="font-mono text-xs">{c.command}</ItemDescription>
        {c.status === "error" || c.status === "not_installed" ? (
          <ItemDescription className="text-destructive">
            {c.error}
            {c.installHint && (
              <>
                {" · install with "}
                <code className="rounded bg-muted px-1 py-px text-foreground">{c.installHint}</code>
              </>
            )}
          </ItemDescription>
        ) : (
          <ItemDescription>{c.description}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" onClick={() => check(c.id)} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCwIcon />}
          {c.status === "unknown" ? "Check" : "Re-check"}
        </Button>
        {!c.builtIn && (
          <Button variant="ghost" size="icon-sm" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}>
            <Trash2Icon />
          </Button>
        )}
      </ItemActions>
    </Item>
  )
}

// Lists the local coding agents owlit can drive, with an install/sign-in check
// per agent and a form for any other ACP-compatible command.
export function ConnectorsDialog() {
  const open = useUiStore((s) => s.connectorsDialogOpen)
  const setOpen = useUiStore((s) => s.setConnectorsDialogOpen)
  const connectors = useChatStore((s) => s.connectors)
  const addCustom = useChatStore((s) => s.addCustomConnector)
  const check = useChatStore((s) => s.checkConnector)
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")

  const add = () => {
    if (!command.trim()) return
    const c = addCustom(name, command)
    setName("")
    setCommand("")
    void check(c.id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Local agent connectors</DialogTitle>
          <DialogDescription>
            owlit talks to coding agents installed on this machine over the Agent Client Protocol. No API keys are stored here; each agent uses its own sign-in.
          </DialogDescription>
        </DialogHeader>
        <ItemGroup className="gap-2">
          {connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </ItemGroup>
        <form
          className="flex flex-col gap-2 rounded-lg border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <div className="text-sm font-medium">Add a custom ACP agent</div>
          <div className="flex gap-2">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
            <Input placeholder="Command, e.g. my-agent --acp" value={command} onChange={(e) => setCommand(e.target.value)} className="flex-1 font-mono" />
            <Button type="submit" variant="outline" disabled={!command.trim()}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
