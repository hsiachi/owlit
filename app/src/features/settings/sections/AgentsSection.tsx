import { useState } from "react"
import { RefreshCwIcon, Trash2Icon } from "lucide-react"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/copy-button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ConnectorStatusChip } from "@/features/chat/components/ConnectorStatusChip"
import { isBroken, isFound as isReady } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@/features/chat/types"
import { useFoldWhile } from "../form-state"
import { FoldedForm, Group, IconAction, List, Note, onHover, Row } from "../parts"
import { EngineSignIns } from "./EngineSignIns"

export function AgentsSection() {
  const connectors = useChatStore((s) => s.connectors)
  const engine = connectors.find((c) => c.signsInHere)
  const [adding, setAdding] = useState(false)
  useFoldWhile(adding, () => setAdding(false))

  // Which agent does background work is chosen under Owlit, beside the reading notes it writes
  return (
    <>
      <Group>
        <List>
          {connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </List>
        <AddAgent open={adding} setOpen={setAdding} />
      </Group>
      {engine && (
        <Group label="Sign-ins" info={`${engine.name} can be signed in to several providers at once. Each chat picks its model, from any of them, in the composer.`}>
          <EngineSignIns connector={engine} />
        </Group>
      )}
    </>
  )
}

// Ready: just the version, quietly. Not installed: a neutral chip. Error: a red chip.
function Status({ c }: { c: Connector }) {
  if (isReady(c)) {
    return c.version && c.version !== "unknown" ? <span className="text-detail text-muted-foreground">{c.version}</span> : null
  }
  return <ConnectorStatusChip c={c} />
}

function ConnectorRow({ connector: c }: { connector: Connector }) {
  const check = useChatStore((s) => s.checkConnector)
  const remove = useChatStore((s) => s.removeConnector)
  const busy = c.status === "checking"

  // A ready agent needs nothing, so its check shows on hover, before the version
  const checkAction = (
    <IconAction label={c.status === "unknown" ? "Check" : "Check again"} onClick={() => check(c.id)} disabled={busy} className={cn(isReady(c) && !busy && onHover)}>
      {busy ? <Spinner /> : <RefreshCwIcon />}
    </IconAction>
  )

  return (
    <Row
      name={<span className={cn(!isReady(c) && c.status !== "checking" && c.status !== "unknown" && "text-muted-foreground")}>{c.name}</span>}
      control={
        <>
          {!c.builtIn && (
            <IconAction label={`Remove ${c.name}`} onClick={() => remove(c.id)} className={onHover}>
              <Trash2Icon />
            </IconAction>
          )}
          {isReady(c) && checkAction}
          <Status c={c} />
          {c.status === "not_installed" && c.installHint && <CopyButton text={c.installHint} label="Copy install command" size="icon-sm" className="last:-mr-1.5" />}
          {!isReady(c) && checkAction}
        </>
      }
    >
      {/* Only problems and user-entered commands earn a second line. A missing agent shows the
          command that fixes it, since that's the one thing the user needs here. */}
      {isBroken(c) && c.error && <Note tone="bad">{c.error}</Note>}
      {c.status === "not_installed" && c.installHint && (
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={c.installHint}>
          {c.installHint}
        </div>
      )}
      {!c.builtIn && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{c.command}</div>}
    </Row>
  )
}

// The custom-agent form stays folded until asked for
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

  return (
    <FoldedForm
      label="Add an agent"
      open={open}
      onOpen={() => setOpen(true)}
      onCancel={close}
      onSubmit={() => {
        if (!command.trim()) return
        void addCustom(name, command).then((c) => check(c.id))
        close()
      }}
      submit="Add agent"
      submitDisabled={!command.trim()}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input autoFocus placeholder="My agent" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Command</span>
        <Input placeholder="my-agent --acp" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono text-detail" />
        <span className="text-xs text-muted-foreground">What owlit runs to start the agent. It must speak ACP over stdio.</span>
      </label>
    </FoldedForm>
  )
}
