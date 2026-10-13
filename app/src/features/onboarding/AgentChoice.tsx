import { useEffect, useRef } from "react"
import { t } from "@lingui/core/macro"
import type { Connector } from "@owlit/protocol"
import { LoaderCircleIcon } from "lucide-react"
import { BorderedList } from "@/components/bordered-list"
import { CopyButton } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { canRun, connectorProblem, problemSentence } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { updateSettings, useSettings } from "@/features/settings/store"
import { cn } from "@/lib/utils"

const isChecking = (c: Connector) => c.status === "checking" || c.status === "unknown"

// The agents on this Mac, and which one Owlit uses. The choice is both background work's agent and new
// chats' agent, so the first day has one answer to "what runs Owlit"; Settings can part them later. Agents
// not ready say what would make them ready, and are checked again when the window comes back to the front,
// since people leave to run the command in Terminal. The Owlit engine (Beta) signs in under Settings, so a
// first run leaves it out.
export function AgentChoice() {
  const connectors = useChatStore((s) => s.connectors).filter((c) => !c.signsInHere)
  const check = useChatStore((s) => s.checkConnector)
  const setSelection = useChatStore((s) => s.setSelection)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const chosen = connectors.find((c) => c.id === background && canRun(c)) ?? connectors.find(canRun)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current || !connectors.length) return
    checked.current = true
    for (const c of connectors) if (!isChecking(c)) void check(c.id)
  }, [connectors, check])

  useEffect(() => {
    const onFocus = () => {
      for (const c of useChatStore.getState().connectors) if (!canRun(c) && !isChecking(c)) void check(c.id)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [check])

  const choose = (c: Connector) => {
    void updateSettings({ backgroundAgent: c.id })
    setSelection({ connectorId: c.id })
  }

  return (
    <BorderedList className="mt-6" role="radiogroup" aria-label={t`Agent for Owlit`}>
      {connectors.map((c) => {
        const ready = canRun(c)
        const on = c.id === chosen?.id
        const problem = connectorProblem(c)
        const command = problem === "not_installed" ? c.installHint : problem === "signed_out" ? (c.signIn ?? c.command) : undefined
        return (
          <div
            key={c.id}
            role="radio"
            aria-checked={on}
            aria-disabled={!ready}
            tabIndex={ready ? 0 : -1}
            onClick={() => ready && choose(c)}
            onKeyDown={(e) => ready && (e.key === "Enter" || e.key === " ") && choose(c)}
            className={cn("flex min-h-13 items-center gap-3 px-3.5 py-2 outline-none", ready ? "cursor-pointer hover:bg-muted focus-key:bg-muted" : "cursor-default")}
          >
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-full ring-[1.5px] ring-border transition-shadow ring-inset", on && "ring-[5px] ring-foreground", !ready && "opacity-40")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.name}</span>
              <span className="flex items-center gap-1.5 text-detail text-muted-foreground">
                {isChecking(c) ? (
                  <>
                    <LoaderCircleIcon className="size-3 animate-spin" />
                    {t({ message: "Checking…", comment: "an agent's status: checking whether it is installed" })}
                  </>
                ) : ready ? (
                  <>
                    <span className="size-1.5 rounded-full bg-owlit-mark" />
                    {c.version && c.version !== "unknown" ? t`Ready · ${c.version}` : t({ message: "Ready", comment: "an agent's status" })}
                  </>
                ) : (
                  <span className="truncate">{problemSentence(c)}</span>
                )}
              </span>
            </span>
            {command && (
              <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                <CopyButton text={command} label={problem === "not_installed" ? t`Copy the install command` : t`Copy the sign-in command`} />
                <Button variant="text" size="inline" onClick={() => void check(c.id)}>
                  {t`Check again`}
                </Button>
              </span>
            )}
          </div>
        )
      })}
    </BorderedList>
  )
}
