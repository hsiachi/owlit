import { t } from "@lingui/core/macro"
import { DEFAULT_ROLE, type Connector } from "@owlit/protocol"
import { RoleLines } from "@/components/role-lines"
import { RowList, rowClass, rowHover } from "@/components/row-list"
import { CopyButton } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { canRun, canSetUp, connectorProblem, isChecking, problemSentence, settingUp, statusLabel, useConnectorRecheck } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { SetupProgress } from "@/features/settings/sections/AgentsSection"
import { BrowserSignIn } from "@/features/settings/sections/BrowserSignIn"
import { updateSettings, useSettings } from "@/features/settings/store"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

// The agents on this Mac, and which one Owlit uses. The choice is both the agent for the tasks you hand
// Owlit and new chats' agent, so the first day has one answer to "what runs Owlit"; Settings can part them
// later. Agents not ready say what would make them ready, and are checked again when the window comes back
// to the front, since people may leave to run a command in Terminal. The Owlit engine (Beta) signs in under
// Settings, so a first run leaves it out. Under the list, what Owlit may do through the agent in its
// default role, in the lines the composer's menu says, so the scope is met here and not found by accident.
export function AgentChoice() {
  return (
    <>
      <AgentList />
      <div className="mt-6 text-sm leading-relaxed text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">{t`As Assistant, its usual role, Owlit`}</p>
        <RoleLines role={DEFAULT_ROLE} />
        <p className="mt-2">{t`Reviewer, which changes nothing of yours, and Co-author, which also runs commands, are in the composer, for one chat at a time.`}</p>
      </div>
    </>
  )
}

function AgentList() {
  const setUp = useChatStore((s) => s.setUpConnector)
  const connectors = useChatStore((s) => s.connectors).filter((c) => !c.signsInHere)
  const check = useChatStore((s) => s.checkConnector)
  const setSelection = useChatStore((s) => s.setSelection)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const chosen = connectors.find((c) => c.id === background && canRun(c)) ?? connectors.find(canRun)
  useConnectorRecheck(connectors)

  const choose = (c: Connector) => {
    void updateSettings({ backgroundAgent: c.id })
    setSelection({ connectorId: c.id })
  }

  return (
    <RowList className="mt-6" role="radiogroup" aria-label={t`Agent for Owlit`}>
      {connectors.map((c) => {
        const ready = canRun(c)
        const on = c.id === chosen?.id
        const problem = connectorProblem(c)
        // owlit sets Claude Code's and Codex's adapters up itself: a missing one is a Set up, and only a
        // missing agent is a command to copy
        const progress = settingUp(c)
        const failed = progress === undefined && canSetUp(c) && !!c.setup?.error
        // Claude Code and Codex sign in in the browser from here; other agents' sign-in is a command
        const browserSignIn = problem === "signed_out" && !!c.browserSignIn
        const command = problem === "not_installed" ? c.installHint : problem === "signed_out" && !browserSignIn ? (c.signIn ?? c.command) : undefined
        return (
          <div
            key={c.id}
            role="radio"
            aria-checked={on}
            aria-disabled={!ready}
            tabIndex={ready ? 0 : -1}
            onClick={() => ready && choose(c)}
            onKeyDown={(e) => ready && (e.key === "Enter" || e.key === " ") && choose(c)}
            className={cn("flex min-h-13 items-center gap-3 py-2 outline-none", rowClass, ready ? cn("cursor-pointer", rowHover) : "cursor-default")}
          >
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-full ring-[1.5px] ring-border transition-shadow ring-inset", on && "ring-[5px] ring-foreground", !ready && "opacity-40")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.name}</span>
              <span className="flex items-center gap-1.5 text-detail text-muted-foreground">
                {isChecking(c) ? (
                  <>
                    <Spinner className="size-3" />
                    {statusLabel("checking")}
                  </>
                ) : ready ? (
                  // Fine is no mark at all (green is Owlit's hand, not "healthy"): its version, as Settings
                  // › Agents shows it; only an agent that can't run says why
                  c.version !== "unknown" && c.version
                ) : failed ? (
                  <span className="truncate text-destructive">{c.setup?.error}</span>
                ) : (
                  // The row already names the agent, so the short word where there is one
                  <span className="truncate">{problem === "not_installed" ? statusLabel("not_installed") : problemSentence(c)}</span>
                )}
              </span>
            </span>
            {/* Set up as Settings › Agents draws it: progress with Cancel, Set up, or Try again after a failure */}
            {progress !== undefined ? (
              <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <SetupProgress c={c} />
              </span>
            ) : canSetUp(c) ? (
              <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                <Button variant="text" size="inline" onClick={() => void setUp(c.id)}>
                  {failed ? t`Try again` : t({ message: "Set up", comment: "verb: fetch owlit's copy of the agent's adapter" })}
                </Button>
              </span>
            ) : browserSignIn ? (
              <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                <BrowserSignIn c={c} variant="text" />
              </span>
            ) : null}
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
    </RowList>
  )
}
