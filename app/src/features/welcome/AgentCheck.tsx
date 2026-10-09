import { useEffect, useRef } from "react"
import type { Connector } from "@owlit/protocol"
import { BotIcon, CopyIcon, LoaderCircleIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/features/chat/store"
import { openSettings } from "@/features/settings/store"

const isReady = (c: Connector) => (c.status === "available" || c.status === "connected") && c.authenticated !== false
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
      if (all.some(isReady)) return
      for (const c of all) if (!isChecking(c)) void check(c.id)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [check])

  // Built-in agents come first, Claude Code first of all, as background work picks them
  const ready = connectors.find(isReady)
  const checking = !connectors.length || connectors.some(isChecking)
  const signedOut = connectors.find((c) => c.status === "error" && c.authenticated === false)
  const broken = connectors.find((c) => c.status === "error")
  const first = connectors.find((c) => c.builtIn && c.installHint)

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    toast("Copied", { description: text })
  }
  const recheck = () => {
    for (const c of useChatStore.getState().connectors) if (!isChecking(c)) void check(c.id)
  }

  let body: React.ReactNode
  if (ready) {
    body = (
      <Line icon={<BotIcon />}>
        <span className="flex-1">
          Owlit will use <span className="font-medium text-foreground">{ready.name}</span>
          {ready.version && ready.version !== "unknown" && ` · ${ready.version}`}
        </span>
        <Button variant="ghost" size="sm" className="-my-1 -mr-2" onClick={() => openSettings("agents")}>
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
      <Line icon={<ShieldAlertIcon className="text-warning" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{signedOut.name} isn’t signed in.</span> Run <code className="font-mono text-xs text-foreground">{command}</code> in Terminal to sign in.
          <div className="mt-1 -ml-2.5 flex gap-0.5">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => copy(command)}>
              <CopyIcon />
              Copy
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={recheck}>
              Check again
            </Button>
          </div>
        </div>
      </Line>
    )
  } else if (broken) {
    body = (
      <Line icon={<ShieldAlertIcon className="text-warning" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{broken.name} can’t run.</span>
          {broken.error && <div className="mt-0.5 text-xs break-words">{broken.error}</div>}
          <div className="mt-1 -ml-2.5 flex gap-0.5">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={recheck}>
              Check again
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openSettings("agents")}>
              Use another agent…
            </Button>
          </div>
        </div>
      </Line>
    )
  } else {
    body = (
      <Line icon={<ShieldAlertIcon className="text-warning" />}>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">Owlit needs a coding agent on this Mac.</span>
          {first?.installHint && (
            <>
              {" "}
              To use {first.name}, run this in Terminal:
              <div className="mt-1 flex items-start gap-1">
                <code className="min-w-0 pt-1 font-mono text-xs break-all text-foreground">{first.installHint}</code>
                <Button variant="ghost" size="icon-xs" className="mt-0.5 text-muted-foreground" aria-label="Copy the install command" onClick={() => copy(first.installHint!)}>
                  <CopyIcon />
                </Button>
              </div>
            </>
          )}
          <div className="mt-1 -ml-2.5 flex gap-0.5">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={recheck}>
              Check again
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openSettings("agents")}>
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
    <div className="flex items-start gap-2.5 text-[13px] leading-normal text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      {children}
    </div>
  )
}
