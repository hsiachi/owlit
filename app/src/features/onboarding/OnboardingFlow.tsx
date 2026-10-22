import { useEffect, useState, type ReactNode } from "react"
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import type { WelcomeInfo } from "@owlit/protocol"
import { FolderPlusIcon, UserIcon, XIcon, type LucideIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { canRun } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { List } from "@/features/settings/parts"
import { InterfaceLanguageRow } from "@/features/settings/sections/AppearanceSection"
import { LanguageRow, NameRow } from "@/features/settings/sections/OwlitSection"
import { useSettings } from "@/features/settings/store"
import { tourWhenExampleOpens } from "@/features/tour/store"
import { useFlowPlace } from "@/features/onboarding/store"
import { AgentSentence, AgentSetup } from "@/features/onboarding/AgentSetup"
import { EXAMPLE_PAPERS } from "@/features/onboarding/content"
import { AskDemo, GreetingDemo, HelloDemo, MiniWindow, ReadDemo, CollectDemo, WriteDemo, type DemoPlace } from "@/features/onboarding/demos"
import { WelcomeLockup } from "@/features/onboarding/WelcomeLockup"
import { KIND_ICON } from "@/lib/kinds"
import { isTyping } from "@/lib/keys"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useControlsRoom } from "@/lib/window-frame"
import { pickParent, pickWorkspaceFolder, switchWorkspace, tilde } from "@/lib/workspace"
import { useWindowKeydown } from "@/hooks/use-window-keydown"

// The first launch: a welcome, four steps that show what owlit does (each a small demo in a small owlit
// window whose rail lifts the place being shown, so where things are is learned with what they do), two
// that set things up (the name and the language, the agent), and where to begin. Only what Owlit needs
// before the first question is asked here: the library proxy waits for the first paywalled PDF, and the
// theme and paper tone are in Settings. Every setup step has a default, so Continue always works; the
// only real choice is the last one. Nothing is a checklist: Skip intro jumps to the setup, and the steps
// can be revisited from the progress bar. Help › How owlit works shows the four introduction steps again
// over the app (mode "replay").

type StepId = "welcome" | "read" | "write" | "ask" | "collect" | "you" | "agent" | "start"
const INTRO: StepId[] = ["read", "write", "ask", "collect"]
const FIRST: StepId[] = ["welcome", ...INTRO, "you", "agent", "start"]

export function OnboardingFlow({ mode = "first", onClose }: { mode?: "first" | "replay"; onClose?: () => void }) {
  const steps = mode === "first" ? FIRST : INTRO
  const { index, seen, welcomed } = useFlowPlace((s) => s[mode])
  const place = useFlowPlace((s) => s.set)
  const setWelcomed = (welcomed: boolean) => place(mode, { welcomed })
  const close = () => onClose?.()
  const controlsRoom = useControlsRoom((s) => s.room)
  const step = steps[index]
  const last = index === steps.length - 1

  const go = (next: number) => {
    const to = Math.max(0, Math.min(steps.length - 1, next))
    place(mode, { index: to, seen: Math.max(seen, to) })
  }
  const forward = () => (last ? close() : go(index + 1))

  // ← and → move between steps, Enter goes on, Esc leaves the replay; not while typing in a field
  useWindowKeydown((e) => {
    const target = e.target instanceof Element ? e.target : null
    if (isTyping(e.target) || target?.closest("[role=menu], [role=dialog]")) return
    if (e.key === "Escape" && mode === "replay") close()
    if (step === "welcome" || step === "start") return
    if (e.key === "ArrowRight" || (e.key === "Enter" && !target?.closest("button"))) forward()
    if (e.key === "ArrowLeft") go(index - 1)
  })

  return (
    <TooltipProvider>
      <div className="relative flex h-svh flex-col bg-background">
        {/* Moves the window, as the app's top bar does; the traffic lights sit at its left */}
        <div className="app-drag h-10 shrink-0" style={controlsRoom ? { paddingLeft: controlsRoom } : undefined} />
        {mode === "replay" && (
          <IconButton label={t`Close`} className="absolute top-2 right-3" onClick={close}>
            <XIcon />
          </IconButton>
        )}
        <main className="relative min-h-0 flex-1">
          {step === "welcome" ? (
            <Welcome welcomed={welcomed} onWelcomed={() => setWelcomed(true)} onStart={() => go(1)} />
          ) : step === "start" ? (
            <Start />
          ) : (
            <Teach step={step} />
          )}
        </main>
        {step !== "welcome" && (
          <footer className="mx-auto flex h-20 w-full max-w-[1104px] shrink-0 items-center gap-2 px-12">
            <div className="flex flex-1 gap-1.5" role="tablist" aria-label={t`Steps`}>
              {steps.map((s, i) =>
                s === "welcome" ? null : (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={stepName(s)}
                    disabled={i > seen}
                    onClick={() => go(i)}
                    className="group/step h-4 w-6 outline-none disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        "block h-[3px] rounded-full bg-foreground/12 transition-colors duration-300",
                        i <= seen && "bg-foreground/30",
                        i === index && "bg-foreground/85",
                        "group-focus-key/step:ring-2 group-focus-key/step:ring-ring/50",
                      )}
                    />
                  </button>
                ),
              )}
            </div>
            {mode === "first" && INTRO.includes(step) && (
              <Button variant="ghost" className="text-muted-foreground" onClick={() => go(steps.indexOf("you"))}>
                {t`Skip intro`}
              </Button>
            )}
            {index > (mode === "first" ? 1 : 0) && (
              <Button variant="ghost" onClick={() => go(index - 1)}>
                {t({ message: "Back", comment: "verb: the step before" })}
              </Button>
            )}
            {step !== "start" && (
              <Button className="min-w-28" onClick={forward}>
                {last ? t({ message: "Done", comment: "closes How owlit works" }) : t`Continue`}
              </Button>
            )}
          </footer>
        )}
      </div>
      {mode === "first" && (
        <>
          <SettingsDialog />
          <Toaster position="bottom-right" />
        </>
      )}
    </TooltipProvider>
  )
}

function stepName(step: StepId) {
  switch (step) {
    case "read":
      return t`Read`
    case "write":
      return t({ message: "Write", comment: "an onboarding step: writing docs" })
    case "ask":
      return t({ message: "Ask", comment: "an onboarding step: asking Owlit" })
    case "collect":
      return t({ message: "Collect", comment: "an onboarding step: Owlit gathers papers for a question" })
    case "you":
      return t`About you`
    case "agent":
      return t({ message: "Agent", comment: "an onboarding step: the agent Owlit runs on" })
    default:
      return t`Where to begin`
  }
}

// Step 0: the lockup writes itself; the line and the button rise in once it has
function Welcome({ welcomed, onWelcomed, onStart }: { welcomed: boolean; onWelcomed: () => void; onStart: () => void }) {
  return (
    <div className="flex h-full -translate-y-6 flex-col items-center justify-center text-center">
      <WelcomeLockup onDone={onWelcomed} />
      <div className={cn("flex flex-col items-center opacity-0", welcomed && "animate-in fade-in slide-in-from-bottom-2 opacity-100 duration-500 fill-mode-both")}>
        <p className="mt-7 text-lg text-muted-foreground">
          <Trans>
            Read, write and think through papers with <span className="font-medium text-owlit">Owlit</span>.
          </Trans>
        </p>
        <Button size="lg" className="mt-8 h-10 px-6" onClick={onStart} autoFocus={welcomed}>
          {t`Get started`}
        </Button>
        <p className="mt-4 text-detail text-muted-foreground">{t`Takes about a minute. You can skip any of it.`}</p>
      </div>
    </div>
  )
}

interface Lesson {
  icon: LucideIcon
  kicker: string
  keys?: string
  title: string
  body: ReactNode
  place: DemoPlace
}

function lesson(step: StepId): Lesson | null {
  switch (step) {
    case "read":
      return {
        icon: KIND_ICON.paper,
        kicker: t`Library`,
        title: t`Read closely.`,
        body: (
          <Trans>
            Drop in PDFs, or paste a DOI or arXiv id. Highlight as you read, and ask Owlit for a <b>digest</b> of any paper.
          </Trans>
        ),
        place: "library",
      }
    case "write":
      return {
        icon: KIND_ICON.doc,
        kicker: t`Docs`,
        title: t`Write with your sources.`,
        body: (
          <Trans>
            Docs are Markdown files in your folder. Type <Key>@</Key> to cite a paper. Owlit edits <b>only when you ask</b>, marks what it changed, and any part can be undone.
          </Trans>
        ),
        place: "docs",
      }
    case "ask":
      return {
        icon: KIND_ICON.chat,
        kicker: t`Chat`,
        keys: "⌘J",
        title: t`Ask anywhere.`,
        body: (
          <Trans>
            Press <Key>⌘J</Key> anywhere to ask about what's on screen. Chat is for <b>longer work</b>, like finding papers.
          </Trans>
        ),
        place: "library",
      }
    case "collect":
      return {
        icon: KIND_ICON.thread,
        kicker: t`Threads`,
        title: t`Owlit reports back.`,
        body: (
          <Trans>
            Ask Owlit a question in a chat and it finds papers on it, says <b>what each one is and how it bears</b> on your question, and writes its report on them. To change a thread, ask in the chat.
          </Trans>
        ),
        place: "threads",
      }
    case "you":
      return { icon: UserIcon, kicker: t`About you`, title: t`A little about you.`, body: t`So Owlit knows what to call you and which language you read. All of it can wait.`, place: "chat" }
    case "agent":
      return {
        icon: KIND_ICON.agent,
        kicker: t({ message: "Agent", comment: "an onboarding step: the agent Owlit runs on" }),
        title: t`What Owlit works through.`,
        body: <AgentSentence />,
        place: "chat",
      }
    default:
      return null
  }
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="mx-0.5 inline-flex h-5 items-center rounded-md bg-muted px-1.5 align-[1px] font-sans text-xs font-medium text-muted-foreground">{children}</kbd>
}

// Steps 1–6: what the step says on the left, the small window on the right
function Teach({ step }: { step: StepId }) {
  const l = lesson(step)!
  const name = useSettings((s) => s.view?.profile.name) ?? ""
  const agentName = useAgentName()
  const Icon = l.icon
  return (
    <div className="mx-auto grid h-full max-w-[1104px] grid-cols-[minmax(0,28rem)_1fr] items-center gap-14 px-12">
      {/* Keyed by step, so each step's words come in fresh */}
      <div key={step} className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <div className="mb-3.5 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" />
          <span>{l.kicker}</span>
          {l.keys && <Key>{l.keys}</Key>}
        </div>
        {/* Set like the wordmark: Dosis slanted by a skew, on one line, since a skew shifts each line of a
            wrapped title by its height; Chinese stands upright */}
        <h1 className="font-display mb-4 -skew-x-6 text-[2.5rem] leading-[1.05] font-medium whitespace-nowrap [&:lang(zh)]:skew-x-0">{l.title}</h1>
        <p className="text-base leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{l.body}</p>
        <Setup step={step} />
      </div>
      <div className="flex justify-center">
        <MiniWindow place={l.place}>
          {step === "read" && <ReadDemo />}
          {step === "write" && <WriteDemo />}
          {step === "ask" && <AskDemo />}
          {step === "collect" && <CollectDemo />}
          {step === "you" && <GreetingDemo name={name} agentName={agentName} />}
          {step === "agent" && <HelloDemo name={name} agentName={agentName} />}
        </MiniWindow>
      </div>
    </div>
  )
}

// The agent Owlit will use: the one chosen for the tasks you hand it, else the first that can run
function useAgentName() {
  const connectors = useChatStore((s) => s.connectors)
  const chosen = useSettings((s) => s.view?.backgroundAgent)
  return (connectors.find((c) => c.id === chosen) ?? connectors.find(canRun) ?? connectors[0])?.name ?? "Claude Code"
}

// The setup steps' controls are Settings' own rows, so what is set here reads the same there
function Setup({ step }: { step: StepId }) {
  if (step === "you")
    return (
      <div className="mt-6">
        <List>
          <NameRow className="w-40" />
          <InterfaceLanguageRow />
          <LanguageRow />
        </List>
      </div>
    )
  if (step === "agent") return <AgentSetup variant="list" />
  return null
}

// The last step: an example to look around, a fresh folder, or a folder the user has
function Start() {
  const [info, setInfo] = useState<WelcomeInfo | null>(null)
  const [parent, setParent] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    rpc.workspace
      .welcome()
      .then((next) => {
        setInfo(next)
        setParent(next.suggestion.parent)
      })
      .catch(toastError)
  }, [])

  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    work()
      .catch(toastError)
      .finally(() => setBusy(false))
  }
  const example = () =>
    run(async () => {
      const cancelTour = tourWhenExampleOpens()
      await switchWorkspace(() => rpc.workspace.createExample()).catch((error: unknown) => {
        cancelTour()
        throw error
      })
    })
  const fresh = () => info && run(() => switchWorkspace(() => rpc.workspace.create({ parent, name: info.suggestion.name })))
  const chooseParent = async () => {
    const folder = await pickParent(parent)
    if (folder) setParent(folder)
  }
  const open = async () => {
    const folder = await pickWorkspaceFolder()
    if (folder) run(() => switchWorkspace(() => rpc.workspace.open({ path: folder })))
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-12 text-center">
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <h1 className="font-display mb-4 -skew-x-6 text-[2.5rem] leading-[1.05] font-medium [&:lang(zh)]:skew-x-0">{t`Where to begin?`}</h1>
        <p className="mx-auto max-w-lg text-base leading-relaxed text-muted-foreground">
          {t`Look around a workspace that's already set up, or start with an empty folder of your own. You can do the other one later.`}
        </p>
      </div>
      <div className="mt-9 grid w-full max-w-3xl grid-cols-2 gap-5 text-left">
        <StartCard
          title={t`Explore an example`}
          note={t`Takes a short tour`}
          detail={t`Eight papers on hallucination and retrieval, with digests, highlights, a draft and Owlit's notes.`}
          disabled={busy}
          onClick={example}
          delay={0}
        >
          <div className="flex flex-col gap-1.5 p-4">
            {EXAMPLE_PAPERS.slice(0, 5).map(([title, by], i) => (
              <div
                key={title}
                style={{ animationDelay: `${200 + i * 70}ms` }}
                className="flex h-6 animate-in items-center gap-2 rounded-md border bg-background px-2 text-xs fade-in slide-in-from-bottom-1 duration-500 fill-mode-both"
              >
                <KIND_ICON.paper className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{title}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{by}</span>
              </div>
            ))}
          </div>
        </StartCard>
        <StartCard
          title={t`Start fresh`}
          detail={t`An empty folder for your own papers and notes. Drop in PDFs, or ask Owlit to find some.`}
          disabled={busy || !info}
          onClick={fresh}
          delay={80}
        >
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <FolderPlusIcon className="size-12 stroke-[1.4] text-muted-foreground/70" />
            <span className="text-detail text-muted-foreground">
              {info ? `${tilde(parent)}/${info.suggestion.name}` : " "}
              <Button
                variant="text"
                size="inline"
                className="ml-1"
                onClick={(e) => {
                  e.stopPropagation()
                  void chooseParent()
                }}
              >
                {t`Change…`}
              </Button>
            </span>
          </div>
        </StartCard>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        <Trans>
          Or{" "}
          <InlineLink onClick={() => void open()}>open a folder you have</InlineLink>
          : notes, an Obsidian vault, PDFs.
        </Trans>
      </p>
    </div>
  )
}

function StartCard({
  title,
  note,
  detail,
  disabled,
  onClick,
  delay,
  children,
}: {
  title: string
  note?: string
  detail: string
  disabled?: boolean
  onClick: () => void
  delay: number
  children: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && onClick()}
      onKeyDown={(e) => {
        // Only the card's own keys: Enter on Change… inside it bubbles up here too, and must not create
        // the workspace while it opens the folder picker. Space would also scroll the page.
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
        e.preventDefault()
        if (!disabled) onClick()
      }}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-in cursor-pointer rounded-xl border bg-card p-3.5 shadow-xs transition-[box-shadow,translate] duration-200 fade-in slide-in-from-bottom-2 fill-mode-both outline-none hover:-translate-y-0.5 hover:shadow-md focus-key:ring-2 focus-key:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-60"
    >
      <div className="mb-3.5 h-42 overflow-hidden rounded-xl bg-sidebar">{children}</div>
      <div className="flex items-baseline gap-2 text-[15px] font-semibold">
        {title}
        {note && <span className="text-xs font-medium text-owlit">{note}</span>}
      </div>
      <p className="mt-1 text-detail leading-normal text-muted-foreground">{detail}</p>
    </div>
  )
}
