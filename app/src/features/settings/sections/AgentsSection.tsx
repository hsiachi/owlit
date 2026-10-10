import { useState } from "react"
import { CopyIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@/features/chat/types"
import { useFoldWhile } from "../form-state"
import { CommitInput, GroupLabel, IconAction, List, Note, onHover, Picker, Row } from "../parts"
import { updateSettings, useSettings } from "../store"

const isReady = (c: Connector) => c.status === "available" || c.status === "connected"

export function AgentsSection() {
  const connectors = useChatStore((s) => s.connectors)
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
      <GroupLabel>Background work</GroupLabel>
      <BackgroundWork />
    </>
  )
}

// Ready: just the version, quietly. Not installed: a neutral chip. Error: a red chip.
function Status({ c }: { c: Connector }) {
  if (isReady(c)) {
    return c.version && c.version !== "unknown" ? <span className="text-[13px] text-muted-foreground">{c.version}</span> : null
  }
  if (c.status === "not_installed" || c.status === "error") {
    return (
      <span className={cn("rounded-md px-1.5 py-0.5 text-xs leading-4", c.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
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

  const copyInstall = () => {
    if (!c.installHint) return
    void navigator.clipboard.writeText(c.installHint)
    toast("Install command copied", { description: c.installHint })
  }

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
          {c.status === "not_installed" && c.installHint && (
            <IconAction label="Copy install command" onClick={copyInstall}>
              <CopyIcon />
            </IconAction>
          )}
          {!isReady(c) && checkAction}
        </>
      }
    >
      {/* Only problems and user-entered commands earn a second line. A missing agent shows the
          command that fixes it, since that's the one thing the user needs here. */}
      {c.status === "error" && c.error && <Note tone="bad">{c.error}</Note>}
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

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2 -ml-2 font-normal text-muted-foreground" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add an agent
      </Button>
    )
  }

  return (
    <form
      className="mt-3 flex flex-col gap-3.5 rounded-lg border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!command.trim()) return
        void addCustom(name, command).then((c) => check(c.id))
        close()
      }}
    >
      <div className="text-sm font-medium">Add an agent</div>
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

// Work nobody is waiting on: reading notes now, Knowledge later
function BackgroundWork() {
  const connectors = useChatStore((s) => s.connectors)
  const view = useSettings((s) => s.view)
  const ready = connectors.filter(isReady)
  // Unset means the first agent that is ready, Claude Code first (core's own choice)
  const fallback = ready.find((c) => c.id === "claude-code") ?? ready[0]
  const chosen = view?.backgroundAgent ?? ""
  const options = [
    { value: "", label: fallback ? `Automatic (${fallback.name})` : "Automatic" },
    ...connectors.filter((c) => isReady(c) || c.id === chosen).map((c) => ({ value: c.id, label: c.name })),
  ]
  return (
    <List>
      <Row
        name="Agent"
        info="Owlit uses this agent for work nobody is waiting on, such as reading notes. Automatic picks the first agent that is ready."
        control={<Picker label="Agent for background work" value={chosen} options={options} onChange={(id) => void updateSettings({ backgroundAgent: id || null })} />}
      />
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
