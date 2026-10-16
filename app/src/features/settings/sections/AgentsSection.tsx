import { t } from "@lingui/core/macro"
import { useState } from "react"
import { RefreshCwIcon, Trash2Icon } from "lucide-react"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/copy-button"
import { revealOnHover } from "@/components/row-list"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ConnectorStatusChip } from "@/features/chat/components/ConnectorStatusChip"
import { Button } from "@/components/ui/button"
import { canSetUp, isBroken, isChecking, isFound as isReady, needsSignIn, settingUp } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@owlit/protocol"
import { useFoldWhile } from "../form-state"
import { FoldedForm, Group, IconAction, List, Note, Row } from "../parts"
import { BrowserSignIn } from "./BrowserSignIn"
import { EngineSignIns } from "./EngineSignIns"
import { useAfterWait } from "@/hooks/use-after-wait"

export function AgentsSection() {
  const connectors = useChatStore((s) => s.connectors)
  const engine = connectors.find((c) => c.signsInHere)
  const engineName = engine?.name ?? ""
  const [adding, setAdding] = useState(false)
  useFoldWhile(adding, () => setAdding(false))

  // Which agent does background work is chosen under Owlit, beside the digests it writes
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
        <Group label={t`Sign-ins`} info={t`${engineName} can be signed in to several providers at once. Each chat picks its model, from any of them, in the composer.`}>
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

// owlit's own copy of the agent's adapter, at the row's right end: setting it up, offering to, or offering
// a newer one beside the version
function SetupControl({ c }: { c: Connector }) {
  const setUp = useChatStore((s) => s.setUpConnector)
  if (settingUp(c) !== undefined) return <SetupProgress c={c} className="last:-mr-1.5" />
  if (canSetUp(c) && !c.setup?.error) {
    const size = c.setup?.sizeMb ?? 300
    return (
      <>
        <span className="text-detail text-muted-foreground">{t`Not set up · about ${size} MB`}</span>
        <Button variant="text" size="inline" className="last:-mr-1.5" onClick={() => void setUp(c.id)}>
          {t({ message: "Set up", comment: "verb: fetch owlit's copy of the agent's adapter" })}
        </Button>
      </>
    )
  }
  if (c.setup?.latest && isReady(c)) {
    const latest = c.setup.latest
    return (
      <Button variant="text" size="inline" className="last:-mr-1.5" onClick={() => void setUp(c.id)}>
        {t`Update to ${latest}`}
      </Button>
    )
  }
  return null
}

// "Setting up… 40%" with Cancel, while owlit sets up its copy of the agent's adapter; here and in the first
// launch's agent choice. className is Cancel's.
export function SetupProgress({ c, className }: { c: Connector; className?: string }) {
  const cancel = useChatStore((s) => s.cancelSetUp)
  const percent = Math.round((settingUp(c) ?? 0) * 100)
  return (
    <>
      <span className="text-detail text-muted-foreground tabular-nums">{t`Setting up… ${percent}%`}</span>
      <Button variant="text" size="inline" className={className} onClick={() => void cancel(c.id)}>
        {t`Cancel`}
      </Button>
    </>
  )
}

function ConnectorRow({ connector: c }: { connector: Connector }) {
  const check = useChatStore((s) => s.checkConnector)
  const remove = useChatStore((s) => s.removeConnector)
  const setUp = useChatStore((s) => s.setUpConnector)
  // owlit sets this one up itself, so a missing adapter isn't a command to copy
  const owned = settingUp(c) !== undefined || canSetUp(c)
  const busy = c.status === "checking"
  const spin = useAfterWait(busy)
  const name = c.name

  // A ready agent needs nothing, so its check shows on hover, before the version
  const checkAction = (
    <IconAction label={c.status === "unknown" ? t({ message: "Check", comment: "verb: check whether the agent is installed and works" }) : t({ message: "Check again", comment: "verb" })} onClick={() => check(c.id)} disabled={busy} className={cn(isReady(c) && !busy && revealOnHover)}>
      {spin ? <Spinner wait={false} /> : <RefreshCwIcon />}
    </IconAction>
  )

  return (
    <Row
      name={<span className={cn(!isReady(c) && !isChecking(c) && "text-muted-foreground")}>{c.name}</span>}
      control={
        <>
          {!c.builtIn && (
            <IconAction label={t`Remove ${name}`} onClick={() => remove(c.id)} className={revealOnHover}>
              <Trash2Icon />
            </IconAction>
          )}
          {isReady(c) && checkAction}
          {!owned && <Status c={c} />}
          <SetupControl c={c} />
          {needsSignIn(c) && <BrowserSignIn c={c} className="last:-mr-1.5" />}
          {c.status === "not_installed" && !owned && installCommand(c) && <CopyButton text={installCommand(c)!} label={t`Copy install command`} size="icon-sm" className="last:-mr-1.5" />}
          {!isReady(c) && !owned && checkAction}
        </>
      }
    >
      {/* Only problems and user-entered commands earn a second line. A missing agent shows the
          command that fixes it, since that's the one thing the user needs here. */}
      {isBroken(c) && c.error && <Note tone="bad">{c.error}</Note>}
      {c.setup?.error && settingUp(c) === undefined && (
        <Note tone="bad">
          {c.setup.error}{" "}
          <Button variant="text" size="inline" onClick={() => void setUp(c.id)}>
            {t`Try again`}
          </Button>
        </Note>
      )}
      {c.status === "not_installed" && !owned && installCommand(c) && (
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={installCommand(c)}>
          {installCommand(c)}
        </div>
      )}
      {!c.builtIn && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{c.command}</div>}
    </Row>
  )
}

// What installs a missing agent; none where owlit sets the agent up itself
const installCommand = (c: Connector) => (c.setup ? undefined : c.installHint)

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
      label={t`Add an agent`}
      open={open}
      onOpen={() => setOpen(true)}
      onCancel={close}
      onSubmit={() => {
        if (!command.trim()) return
        void addCustom(name, command).then((c) => check(c.id))
        close()
      }}
      submit={t`Add agent`}
      submitDisabled={!command.trim()}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t`Name`}</span>
        <Input autoFocus placeholder={t`My agent`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t`Command`}</span>
        {/* i18n-ignore */}
        <Input placeholder="my-agent --acp" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono text-detail" />
        <span className="text-xs text-muted-foreground">{t`What owlit runs to start the agent. It must speak ACP over stdio.`}</span>
      </label>
    </FoldedForm>
  )
}
