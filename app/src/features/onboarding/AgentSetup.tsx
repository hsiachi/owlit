import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { DEFAULT_ROLE, type Connector } from "@owlit/protocol"
import { CopyButton } from "@/components/copy-button"
import { InlineLink } from "@/components/inline-link"
import { KindIcon } from "@/components/kind-icon"
import { RoleLines } from "@/components/role-lines"
import { RowList, rowClass, rowHover } from "@/components/row-list"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { canRun, canSetUp, connectorProblem, isChecking, problemSentence, settingUp, statusLabel, useConnectorRecheck } from "@/features/chat/lib/connector-status"
import { otherRolesSentence } from "@/features/chat/lib/selection"
import { useChatStore } from "@/features/chat/store"
import { SetupProgress } from "@/features/settings/sections/AgentsSection"
import { BrowserSignIn } from "@/features/settings/sections/BrowserSignIn"
import { openSettings, updateSettings, useSettings } from "@/features/settings/store"
import { cn } from "@/lib/utils"

// Which agent runs Owlit, and what would make one ready, in one vocabulary wherever it is asked: the
// first launch draws it as a list to choose from ("list"), the welcome page as one line under its
// actions ("line"). Agents not ready are checked again when the window comes back to the front, since
// people may leave to run a command in Terminal. The Owlit engine (Beta) signs in under Settings, so it
// is never one of the choices here.

// The one sentence about what Owlit needs, said the same in both places
export function AgentSentence() {
  return <>{t`Owlit works through Claude Code or Codex, signed in with your Claude or ChatGPT account.`}</>
}

export function AgentSetup({ variant }: { variant: "list" | "line" }) {
  return variant === "list" ? <AgentChoice /> : <AgentLine />
}

// What would make one agent ready, as text buttons: Set up (with its progress and Cancel), Try again
// after a failed set up, Sign in… in the browser, or a command to copy and Check again
function AgentFix({ c, named }: { c: Connector; named?: boolean }) {
  const setUp = useChatStore((s) => s.setUpConnector)
  const check = useChatStore((s) => s.checkConnector)
  const problem = connectorProblem(c)
  const name = c.name
  if (settingUp(c) !== undefined) return <SetupProgress c={c} />
  if (canSetUp(c)) {
    const label = c.setup?.error ? t`Try again` : named ? t({ message: `Set up ${name}`, comment: "fetch owlit's copy of an agent, e.g. Set up Claude Code" }) : t({ message: "Set up", comment: "verb: fetch owlit's copy of the agent's adapter" })
    return (
      <Button variant="text" size="inline" onClick={() => void setUp(c.id)}>
        {label}
      </Button>
    )
  }
  if (problem === "signed_out" && c.browserSignIn) return <BrowserSignIn c={c} variant="text" />
  const command = problem === "not_installed" ? c.installHint : problem === "signed_out" ? (c.signIn ?? c.command) : undefined
  if (!command && problem !== "error") return null
  return (
    <>
      {command && <CopyButton text={command} label={problem === "not_installed" ? t`Copy the install command` : t`Copy the sign-in command`} />}
      <Button variant="text" size="inline" onClick={() => void check(c.id)}>
        {t`Check again`}
      </Button>
    </>
  )
}

// The first launch: the agents on this Mac, and which one Owlit uses. The choice is both the agent for
// the tasks you hand Owlit and new chats' agent, so the first day has one answer to "what runs Owlit";
// Settings can part them later. Under the list, what Owlit may do through the agent in its default role,
// in the lines the composer's menu says, so the scope is met here and not found by accident.
function AgentChoice() {
  const connectors = useChatStore((s) => s.connectors).filter((c) => !c.signsInHere)
  const setSelection = useChatStore((s) => s.setSelection)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const chosen = connectors.find((c) => c.id === background && canRun(c)) ?? connectors.find(canRun)
  // The Owlit engine is not among these (it signs in here, later); the agents listed all run commands
  const commands = chosen?.commands ?? true
  useConnectorRecheck(connectors)

  const choose = (c: Connector) => {
    void updateSettings({ backgroundAgent: c.id })
    setSelection({ connectorId: c.id })
  }

  return (
    <>
      <RowList className="mt-6" role="radiogroup" aria-label={t`Agent for Owlit`}>
        {connectors.map((c) => {
          const ready = canRun(c)
          const on = c.id === chosen?.id
          const problem = connectorProblem(c)
          const failed = settingUp(c) === undefined && canSetUp(c) && !!c.setup?.error
          return (
            <div
              key={c.id}
              role="radio"
              aria-checked={on}
              aria-disabled={!ready}
              tabIndex={ready ? 0 : -1}
              onClick={() => ready && choose(c)}
              onKeyDown={(e) => {
                if (!ready || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
                e.preventDefault()
                choose(c)
              }}
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
              {!ready && (
                <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <AgentFix c={c} />
                </span>
              )}
            </div>
          )
        })}
      </RowList>
      <div className="mt-6 text-sm leading-relaxed text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">{t`As Assistant, its usual role, Owlit`}</p>
        <RoleLines role={DEFAULT_ROLE} commands={commands} />
        <p className="mt-2">{otherRolesSentence(commands)}</p>
      </div>
    </>
  )
}

// The welcome page: one line saying whether an agent on this Mac can run Owlit, and the one thing that
// would make one ready. It only reports; Create and Open work either way.
function AgentLine() {
  const connectors = useChatStore((s) => s.connectors)
  useConnectorRecheck(connectors, { untilOneRuns: true })

  // Built-in agents come first, Claude Code first of all, as the tasks you hand Owlit pick them
  const ready = connectors.find(canRun)
  const checking = !connectors.length || connectors.some(isChecking)
  const agents = connectors.filter((c) => !c.signsInHere)
  const engine = connectors.find((c) => c.signsInHere)
  // The agent closest to running: one being set up, one whose set up failed, one signed out, one on this
  // Mac that owlit can set up, one that can't run
  const near =
    agents.find((c) => settingUp(c) !== undefined) ??
    agents.find((c) => canSetUp(c) && !!c.setup?.error) ??
    agents.find((c) => connectorProblem(c) === "signed_out") ??
    agents.find((c) => canSetUp(c) && c.setup?.cliFound) ??
    agents.find((c) => connectorProblem(c) === "error")
  const settable = agents.filter(canSetUp)
  const installable = agents.find((c) => c.builtIn && c.installHint)

  if (ready) {
    const name = ready.name
    return (
      <Line icon={<KindIcon kind="agent" />}>
        <span className="flex-1">
          <Trans>
            Owlit will use <span className="font-medium text-foreground">{name}</span>
          </Trans>
          {ready.version && ready.version !== "unknown" && ` · ${ready.version}`}
        </span>
        <Button variant="text" size="inline" className="-my-1 -mr-1.5" onClick={() => openSettings("agents")}>
          {t`Change…`}
        </Button>
      </Line>
    )
  }
  if (checking)
    return (
      <Line icon={<Spinner />}>
        <span>{t`Looking for an agent on this Mac…`}</span>
      </Line>
    )

  return (
    <Line>
      <div className="min-w-0 flex-1">
        <span className="text-foreground">
          <AgentSentence />
        </span> {near ? nearSentence(near) : !settable.length && installable ? t`Install one, then check again:` : null}
        {near && canSetUp(near) && near.setup?.error && <div className="mt-0.5 text-destructive">{near.setup.error}</div>}
        {near?.status === "error" && near.error && <div className="mt-0.5 text-xs break-words">{near.error}</div>}
        {!near && !settable.length && installable?.installHint && <code className="mt-1 block font-mono text-xs break-all text-foreground">{installable.installHint}</code>}
        <div className="mt-1 -ml-1.5 flex items-center gap-0.5">
          {near ? <AgentFix c={near} /> : settable.length ? settable.map((c) => <AgentFix key={c.id} c={c} named />) : installable && <AgentFix c={installable} />}
          {(!near || connectorProblem(near) === "error") && (
            <Button variant="text" size="inline" onClick={() => openSettings("agents")}>
              {t`Use another agent…`}
            </Button>
          )}
        </div>
        {engine && !near && (
          <p className="mt-2">
            <Trans>
              Or <InlineLink onClick={() => openSettings("agents")}>sign in with ChatGPT</InlineLink> to use the Owlit engine (Beta).
            </Trans>
          </p>
        )}
      </div>
    </Line>
  )
}

// Where the agent closest to running stands, after the sentence
function nearSentence(c: Connector) {
  const name = c.name
  if (settingUp(c) !== undefined) return t`Setting up ${name}.`
  if (canSetUp(c) && c.setup?.error) return t`${name} couldn't be set up.`
  if (canSetUp(c)) {
    const size = c.setup?.sizeMb ?? 300
    return t`${name} is on this Mac. Set it up for Owlit (about ${size} MB).`
  }
  const problem = problemSentence(c) ?? ""
  if (connectorProblem(c) === "signed_out") return c.browserSignIn ? t`${problem}. Sign in with your account in the browser.` : t`${problem}. Sign in in Terminal, then check again.`
  return t`${problem}.`
}

// A problem is told in words, the problem itself in the text colour; only the found agent and the search
// for one lead with an icon
function Line({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-9 border-t px-2.5 pt-3.5">
      <div className="flex items-start gap-2.5 text-detail leading-normal text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
        {icon}
        {children}
      </div>
    </div>
  )
}
