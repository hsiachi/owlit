import { useState } from "react"
import { CopyIcon, LogOutIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { needsSignIn } from "@/features/chat/components/composer/AgentPicker"
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
  if (needsSignIn(c)) return <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs leading-4 text-muted-foreground">Not signed in</span>
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
  const signOut = useChatStore((s) => s.signOutConnector)
  const busy = c.status === "checking"
  const signsInHere = !!c.signInMethods?.length || c.id === "owlit-engine"

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
          {isReady(c) && signsInHere && (
            <IconAction label="Sign out" onClick={() => void signOut(c.id).catch((e: Error) => toast.error(e.message))} className={onHover}>
              <LogOutIcon />
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
      {needsSignIn(c) ? <SignIn connector={c} /> : c.status === "error" && c.error && <Note tone="bad">{c.error}</Note>}
      {c.status === "not_installed" && c.installHint && (
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={c.installHint}>
          {c.installHint}
        </div>
      )}
      {!c.builtIn && <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{c.command}</div>}
    </Row>
  )
}

// An agent that signs in inside owlit: ChatGPT in the browser, or an API key in a form that unfolds under
// the row, as the custom-agent form does
function SignIn({ connector: c }: { connector: Connector }) {
  const signIn = useChatStore((s) => s.signInConnector)
  const methods = c.signInMethods ?? []
  const browser = methods.find((m) => !m.apiKey)
  const keys = methods.filter((m) => m.apiKey)
  const [waiting, setWaiting] = useState(false)
  const [keyForm, setKeyForm] = useState(false)
  const [method, setMethod] = useState(keys[0]?.id ?? "")
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  useFoldWhile(keyForm, () => setKeyForm(false))

  const run = async (methodId: string, apiKey?: string) => {
    setError(null)
    try {
      await signIn(c.id, methodId, apiKey)
      setKeyForm(false)
      setKey("")
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mt-1.5">
      {!keyForm && (
        <div className="flex items-center gap-1">
          {browser && (
            <Button
              variant="outline"
              size="sm"
              disabled={waiting}
              onClick={() => {
                setWaiting(true)
                void run(browser.id).finally(() => setWaiting(false))
              }}
            >
              {waiting && <Spinner />}
              {browser.name}
            </Button>
          )}
          {keys.length > 0 && (
            <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" disabled={waiting} onClick={() => setKeyForm(true)}>
              Use an API key
            </Button>
          )}
        </div>
      )}
      {waiting && <Note>Finish signing in in your browser.</Note>}
      {keyForm && (
        <form
          className="mt-1 flex flex-col gap-3.5 rounded-lg border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim()) void run(method, key.trim())
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Provider</span>
            <Picker label="Provider" value={method} options={keys.map((m) => ({ value: m.id, label: m.name.replace(/ API key$/, "") }))} onChange={setMethod} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">API key</span>
            <Input autoFocus type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-[13px]" />
            <span className="text-xs text-muted-foreground">Kept on this Mac, in owlit's own folder. Model requests are billed to this key.</span>
          </label>
          <div className="flex justify-end gap-2 pt-0.5">
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => setKeyForm(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!key.trim()}>
              Save key
            </Button>
          </div>
        </form>
      )}
      {error && <Note tone="bad">{error}</Note>}
    </div>
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
