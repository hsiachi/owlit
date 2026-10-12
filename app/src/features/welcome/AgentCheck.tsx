import { useEffect, useRef } from "react"
import type { Connector } from "@owlit/protocol"
import { CopyIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { CopyButton } from "@/components/copy-button"
import { WaitingShield } from "@/components/marks"
import { KindIcon } from "@/components/kind-icon"
import { Button } from "@/components/ui/button"
import { canRun, connectorProblem, problemSentence } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { openSettings } from "@/features/settings/store"
import { copyText } from "@/lib/clipboard"

const isChecking = (c: Connector) => c.status === "checking" || c.status === "unknown"

// One line at the bottom of the welcome page: whether an agent on this Mac can run Owlit. It only
// reports; Create and Open work either way. Every agent is checked afresh when the page opens, and the
// ones that aren't ready again when the window comes back to the front, since people leave to run the
// install or sign-in command in Terminal.
export function AgentCheck() {
  const connectors = useChatStore((s) => s.connectors)
  const check = useChatStore((s) => s.checkConnector)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current || !connectors.length) return
    checked.current = true
    for (const c of connectors) if (c.status !== "checking") void check(c.id)
  }, [connectors, check])

  useEffect(() => {
    const onFocus = () => {
      const all = useChatStore.getState().connectors
      if (all.some(canRun)) return
      for (const c of all) if (!isChecking(c)) void check(c.id)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [check])

  // Built-in agents come first, Claude Code first of all, as background work picks them
  const ready = connectors.find(canRun)
  const checking = !connectors.length || connectors.some(isChecking)
  // The Owlit engine (Beta) signs in under Settings, not in Terminal, and isn't what a first run is about
  const installed = connectors.filter((c) => !c.signsInHere)
  const signedOut = installed.find((c) => connectorProblem(c) === "signed_out")
  const broken = installed.find((c) => connectorProblem(c) === "error")
  const first = connectors.find((c) => c.builtIn && c.installHint)

  const copy = (text: string) => {
    void copyText(text).then((ok) => ok && toast("Copied", { description: text }))
  }
  const recheck = () => {
    for (const c of useChatStore.getState().connectors) if (!isChecking(c)) void check(c.id)
  }

  let body: React.ReactNode
  if (ready) {
    body = (
      <Line icon={<KindIcon kind="agent" />}>
        <span className="flex-1">
          Owlit will use <span className="font-medium text-foreground">{ready.name}</span>
          {ready.version && ready.version !== "unknown" && ` · ${ready.version}`}
        </span>
        <Button variant="text" size="inline" className="-my-1 -mr-1.5" onClick={() => openSettings("agents")}>
          Change…
        </Button>
      </Line>
    )
  } else if (checking) {
    body = (
      <Line icon={<LoaderCircleIcon className="animate-spin" />}>
        <span>Looking for an agent on this Mac…</span>
      </Line>
    )
  } else if (signedOut) {
    const command = signedOut.signIn ?? signedOut.command
    body = (
      <Line icon={<WaitingShield size="md" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{problemSentence(signedOut)}.</span> Run <code className="font-mono text-xs text-foreground">{command}</code> in Terminal to sign in.
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={() => copy(command)}>
              <CopyIcon />
              Copy
            </Button>
            <Button variant="text" size="inline" onClick={recheck}>
              Check again
            </Button>
          </div>
        </div>
      </Line>
    )
  } else if (broken) {
    body = (
      <Line icon={<WaitingShield size="md" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{problemSentence(broken)}.</span>
          {broken.error && <div className="mt-0.5 text-xs break-words">{broken.error}</div>}
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={recheck}>
              Check again
            </Button>
            <Button variant="text" size="inline" onClick={() => openSettings("agents")}>
              Use another agent…
            </Button>
          </div>
        </div>
      </Line>
    )
  } else {
    body = (
      <Line icon={<WaitingShield size="md" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">Owlit needs a coding agent on this Mac.</span>
          {first?.installHint && (
            <>
              {" "}
              To use {first.name}, run this in Terminal:
              <div className="mt-1 flex items-start gap-1">
                <code className="min-w-0 pt-1 font-mono text-xs break-all text-foreground">{first.installHint}</code>
                <CopyButton text={first.installHint} label="Copy the install command" className="mt-0.5" />
              </div>
            </>
          )}
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={recheck}>
              Check again
            </Button>
            <Button variant="text" size="inline" onClick={() => openSettings("agents")}>
              Use another agent…
            </Button>
          </div>
        </div>
      </Line>
    )
  }

  return <div className="mt-9 border-t px-2.5 pt-3.5">{body}</div>
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-detail leading-normal text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      {children}
    </div>
  )
}
