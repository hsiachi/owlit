import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { CopyIcon } from "lucide-react"
import { toast } from "sonner"
import { CopyButton } from "@/components/copy-button"
import { InlineLink } from "@/components/inline-link"
import { KindIcon } from "@/components/kind-icon"
import { Button } from "@/components/ui/button"
import { canRun, canSetUp, connectorProblem, isChecking, problemSentence, settingUp, useConnectorRecheck } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { openSettings } from "@/features/settings/store"
import { copyText } from "@/lib/clipboard"
import { Spinner } from "@/components/ui/spinner"

// One line at the bottom of the welcome page: whether an agent on this Mac can run Owlit. It only
// reports; Create and Open work either way. Every agent is checked afresh when the page opens, and the
// ones that aren't ready again when the window comes back to the front, since people leave to run the
// install or sign-in command in Terminal.
export function AgentCheck() {
  const connectors = useChatStore((s) => s.connectors)
  const check = useChatStore((s) => s.checkConnector)
  useConnectorRecheck(connectors, { untilOneRuns: true })

  // Built-in agents come first, Claude Code first of all, as background work picks them
  const ready = connectors.find(canRun)
  const checking = !connectors.length || connectors.some(isChecking)
  // The Owlit engine (Beta) signs in under Settings, not in Terminal, and isn't what a first run is about
  const installed = connectors.filter((c) => !c.signsInHere)
  const signedOut = installed.find((c) => connectorProblem(c) === "signed_out")
  const broken = installed.find((c) => connectorProblem(c) === "error")
  const first = connectors.find((c) => c.builtIn && c.installHint)
  // owlit's own copy of an adapter: being set up, failed, or ready to set up for an agent on this Mac
  const busy = connectors.find((c) => settingUp(c) !== undefined)
  const failed = connectors.find((c) => c.setup?.error && !c.setup.installed)
  const settable = connectors.find(canSetUp)
  const ownable = connectors.filter((c) => c.setup)
  const engine = connectors.find((c) => c.signsInHere)
  const setUp = useChatStore((s) => s.setUpConnector)
  const cancelSetUp = useChatStore((s) => s.cancelSetUp)

  const copy = (text: string) => {
    void copyText(text).then((ok) => ok && toast(t`Copied`, { description: text }))
  }
  const recheck = () => {
    for (const c of useChatStore.getState().connectors) if (!isChecking(c)) void check(c.id)
  }

  let body: React.ReactNode
  if (ready) {
    const name = ready.name
    body = (
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
  } else if (checking) {
    body = (
      <Line icon={<Spinner />}>
        <span>{t`Looking for an agent on this Mac…`}</span>
      </Line>
    )
  } else if (busy) {
    const name = busy.name
    const percent = Math.round((settingUp(busy) ?? 0) * 100)
    body = (
      <Line icon={<Spinner />}>
        <span className="flex-1 tabular-nums">{t`Setting up ${name}… ${percent}%`}</span>
        <Button variant="text" size="inline" className="-my-1 -mr-1.5" onClick={() => void cancelSetUp(busy.id)}>
          {t`Cancel`}
        </Button>
      </Line>
    )
  } else if (signedOut) {
    const command = signedOut.signIn ?? signedOut.command
    const problem = problemSentence(signedOut)
    body = (
      <Line>
        <div className="min-w-0 flex-1">
          <Trans>
            <span className="text-foreground">{problem}.</span> Run <code className="font-mono text-xs text-foreground">{command}</code> in Terminal to sign in.
          </Trans>
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={() => copy(command)}>
              <CopyIcon />
              {t({ message: "Copy", comment: "verb: copy the sign-in command" })}
            </Button>
            <Button variant="text" size="inline" onClick={recheck}>
              {t`Check again`}
            </Button>
          </div>
        </div>
      </Line>
    )
  } else if (failed) {
    const name = failed.name
    body = (
      <Line>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{t`${name} couldn't be set up.`}</span>
          <div className="mt-0.5 text-destructive">{failed.setup?.error}</div>
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={() => void setUp(failed.id)}>
              {t`Try again`}
            </Button>
          </div>
        </div>
      </Line>
    )
  } else if (settable) {
    const name = settable.name
    const size = settable.setup?.sizeMb ?? 300
    body = (
      <Line>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{t`${name} is on this Mac.`}</span> {t`Set it up for Owlit (about ${size} MB).`}
          {/* A text button, as Set up is in Settings and in the first launch's agent choice */}
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={() => void setUp(settable.id)}>
              {t({ message: "Set up", comment: "verb: fetch owlit's copy of the agent's adapter" })}
            </Button>
          </div>
        </div>
      </Line>
    )
  } else if (broken) {
    const problem = problemSentence(broken) ?? ""
    body = (
      <Line>
        <div className="min-w-0 flex-1">
          <span className="text-foreground">{t`${problem}.`}</span>
          {broken.error && <div className="mt-0.5 text-xs break-words">{broken.error}</div>}
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={recheck}>
              {t`Check again`}
            </Button>
            <Button variant="text" size="inline" onClick={() => openSettings("agents")}>
              {t`Use another agent…`}
            </Button>
          </div>
        </div>
      </Line>
    )
  } else {
    const name = first?.name ?? ""
    body = (
      <Line>
        <div className="min-w-0 flex-1">
          {ownable.length ? (
            <>
              <span className="text-foreground">{t`Owlit works through Claude Code or Codex.`}</span> {t`Install one in Terminal, then sign in:`}
              {ownable.map((c) => (
                <div key={c.id} className="mt-1 flex items-start gap-1">
                  <code className="min-w-0 pt-1 font-mono text-xs break-all text-foreground">{c.setup!.installCli}</code>
                  <CopyButton text={c.setup!.installCli} label={t`Copy the install command`} className="mt-0.5" />
                </div>
              ))}
            </>
          ) : (
            <>
              <span className="text-foreground">{t`Owlit needs a coding agent on this Mac.`}</span>
              {first?.installHint && (
                <>
                  {" "}
                  {t`To use ${name}, run this in Terminal:`}
                  <div className="mt-1 flex items-start gap-1">
                    <code className="min-w-0 pt-1 font-mono text-xs break-all text-foreground">{first.installHint}</code>
                    <CopyButton text={first.installHint} label={t`Copy the install command`} className="mt-0.5" />
                  </div>
                </>
              )}
            </>
          )}
          <div className="mt-1 -ml-1.5 flex gap-0.5">
            <Button variant="text" size="inline" onClick={recheck}>
              {t`Check again`}
            </Button>
            <Button variant="text" size="inline" onClick={() => openSettings("agents")}>
              {t`Use another agent…`}
            </Button>
          </div>
          {engine && (
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

  return <div className="mt-9 border-t px-2.5 pt-3.5">{body}</div>
}

// A problem is told in words, the problem itself in the text colour; only the found agent and the search
// for one lead with an icon
function Line({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-detail leading-normal text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      {children}
    </div>
  )
}
