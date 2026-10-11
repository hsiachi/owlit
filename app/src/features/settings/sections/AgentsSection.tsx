import { useState } from "react"
import { RefreshCwIcon, Trash2Icon } from "lucide-react"
import { FIRST_CHOICE_AGENT } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/copy-button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ConnectorStatusChip } from "@/features/chat/components/ConnectorStatusChip"
import { isBroken, isFound as isReady } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@/features/chat/types"
import { useFoldWhile } from "../form-state"
import { CommitInput, FoldedForm, GroupLabel, IconAction, List, Note, onHover, Picker, Row } from "../parts"
import { EngineSignIns } from "./EngineSignIns"
import { updateSettings, useSettings } from "../store"

export function AgentsSection() {
  const connectors = useChatStore((s) => s.connectors)
  const engine = connectors.find((c) => c.signsInHere)
  const [adding, setAdding] = useState(false)
  useFoldWhile(adding, () => setAdding(false))

  return (
    <>
      <List>
        {connectors.map((c) => (
          <ConnectorRow key={c.id} connector={c} />
        ))}
      </List>
      <AddAgent open={adding} setOpen={setAdding} />
      {engine && (
        <>
          <GroupLabel info="The engine can be signed in to several providers at once. Each chat picks its model, from any of them, in the composer.">{engine.name}</GroupLabel>
          <EngineSignIns connector={engine} />
        </>
      )}
      <GroupLabel>Background work</GroupLabel>
      <BackgroundWork />
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

// Work nobody is waiting on: reading notes now, Knowledge later
function BackgroundWork() {
  const connectors = useChatStore((s) => s.connectors)
  const view = useSettings((s) => s.view)
  const ready = connectors.filter(isReady)
  // Unset means the first agent that is ready, owlit's first choice first (core's own choice)
  const fallback = ready.find((c) => c.id === FIRST_CHOICE_AGENT) ?? ready[0]
  const chosen = view?.backgroundAgent ?? ""
  const options = [
    { value: "", label: fallback ? `Automatic (${fallback.name})` : "Automatic" },
    ...connectors.filter((c) => isReady(c) || c.id === chosen).map((c) => ({ value: c.id, label: c.name })),
  ]
  // The agent doing the work, and the models it offers (an agent's own "Default" is not a real choice)
  const agent = connectors.find((c) => c.id === (chosen || fallback?.id))
  const models = agent?.models.filter((m) => m.id !== "default") ?? []
  const defaultModel = models.find((m) => m.id === agent?.defaultModelId) ?? models[0]
  const groups = new Set(models.map((m) => m.group).filter(Boolean)).size
  const modelOptions = [
    { value: "", label: defaultModel ? `Its default (${defaultModel.name})` : "Its default" },
    // Models from more than one sign-in say whose they are, as the composer's headings do
    ...models.map((m) => ({ value: m.id, label: groups > 1 && m.group ? `${m.group} · ${m.name}` : m.name })),
  ]
  const chosenModel = (agent && view?.backgroundModels?.[agent.id]) ?? ""
  return (
    <List>
      <Row
        name="Agent"
        info="Owlit uses this agent for work nobody is waiting on, such as reading notes. Automatic picks the first agent that is ready."
        control={<Picker label="Agent for background work" value={chosen} options={options} onChange={(id) => void updateSettings({ backgroundAgent: id || null })} />}
      />
      {agent && models.length > 1 && (
        <Row
          name="Model"
          info="The model this agent uses for work nobody is waiting on. A smaller one costs less, and reading notes rarely need the strongest."
          control={<Picker label="Model for background work" value={chosenModel} options={modelOptions} onChange={(model) => void updateSettings({ backgroundModel: { agent: agent.id, model: model || null } })} />}
        />
      )}
      <Row
        name="Reading notes in"
        info="The language Owlit writes reading notes in. Papers keep their own language."
        // Unset is English (core's default), shown as the value rather than a placeholder that looks like one
        control={
          <CommitInput
            aria-label="Reading notes language"
            placeholder="English"
            value={view?.library.digestLanguage ?? "English"}
            onCommit={(language) => void updateSettings({ library: { digestLanguage: language && language !== "English" ? language : null } })}
            className="w-40"
          />
        }
      />
      <Row
        name="Reading notes for every paper"
        info="Off: Owlit writes a reading note when you open or star a paper. On: for every paper once its text is in, which keeps the agent busy after a big import."
        control={<Switch checked={view?.library.digestEveryPaper ?? false} onCheckedChange={(on) => void updateSettings({ library: { digestEveryPaper: on } })} aria-label="Reading notes for every paper" />}
      />
    </List>
  )
}
