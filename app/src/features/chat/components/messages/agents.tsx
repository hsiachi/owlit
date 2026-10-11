import { useEffect, useRef, useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { FadeClip, ShowAllButton } from "@/components/fade-clip"
import { GroupLabel } from "@/components/group-label"
import { WaitingLabel, WaitingShield } from "@/components/marks"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Part } from "../../types"
import { stepWords, type ToolCall } from "../../lib/step-words"
import { Markdown } from "./Markdown"
import { StepsPart, type StepAsks, type StepPart } from "./parts"

export type AgentPart = Part<"agent">

// The agents the answering agent handed parts of the work to at one point of the answer, as one block where
// they were handed out. It reads like a plan: open while they work, folded into one line once all are done.
// Each agent is a row named by its task; its steps never mix into the answer's own. A row opens to the
// report the agent handed back, then its own steps as an ordinary steps block.

// What one agent did, for the right end of its row once it is done: what it changed (papers added, reading
// notes kept, files edited), else how many steps it took. Its failed searches are normal and stay inside.
export function agentDone(steps: StepPart[]) {
  const calls = steps.filter((p): p is ToolCall => p.type === "tool_call" && p.status === "completed")
  const owlit = (c: ToolCall, tool: string) => new RegExp(`(?:^|__|\\.)${tool}$`).test(c.tool?.name ?? c.title)
  const papers = calls.filter((c) => owlit(c, "library_add")).reduce((n, c) => n + (c.content?.match(/^Added /gm)?.length ?? 0), 0)
  if (papers) return papers === 1 ? "Added a paper" : `Added ${papers} papers`
  const notes = calls.filter((c) => owlit(c, "library_write_digest")).length
  if (notes) return notes === 1 ? "Wrote a reading note" : `Wrote ${notes} reading notes`
  const files = [...new Set(calls.filter((c) => c.kind === "edit").map((c) => c.tool?.path ?? c.diff?.path ?? c.locations?.[0]?.path).filter(Boolean))]
  if (files.length === 1) return `Edited ${files[0]!.split("/").pop()}`
  if (files.length > 1) return `Edited ${files.length} files`
  const shown = steps.filter((p) => p.type === "tool_call" && !stepWords(p).hidden).length
  return shown ? (shown === 1 ? "1 step" : `${shown} steps`) : undefined
}

// The step an agent is at now, in the steps' own words ("Searching your Library for “…”")
function agentNow(steps: StepPart[]) {
  const calls = steps.filter((p): p is ToolCall => p.type === "tool_call" && !stepWords(p).hidden)
  const running = [...calls].reverse().find((c) => c.status === "in_progress" || c.status === "pending")
  return running ? stepWords(running).now : steps.at(-1)?.type === "thought" ? "Thinking" : "Starting"
}

// A report as an answer reads, cut with a fade until Show all
function Report({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const [long, setLong] = useState(false)
  return (
    <div>
      <FadeClip open={all} long={long} onLong={setLong} max="max-h-56" className="text-sm">
        <Markdown text={text} className="text-sm" />
      </FadeClip>
      {long && <ShowAllButton open={all} onClick={() => setAll((a) => !a)} className="-ml-1.5 mt-0.5" />}
    </div>
  )
}

function AgentRow({ agent, steps, streaming, asks }: { agent: AgentPart; steps: StepPart[]; streaming: boolean; asks: StepAsks }) {
  const [open, setOpen] = useState(false)
  const waiting = !!asks.waiting && steps.some((p) => p.type === "tool_call" && p.toolCallId === asks.waiting)
  const working = agent.status === "working" && streaming
  let right: React.ReactNode
  if (waiting) right = <WaitingLabel />
  else if (working) right = <span className="truncate">{agentNow(steps)}</span>
  else if (agent.status === "stopped" || (agent.status === "working" && !streaming)) right = "Stopped"
  else if (agent.status === "done") right = agentDone(steps)
  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-foreground/80 outline-none hover:bg-foreground/[0.025] hover:text-foreground focus-key:bg-foreground/[0.04]"
      >
        {/* While it works its task shimmers; the step it is at stays plain at the right */}
        <span className={cn("min-w-0 shrink-0 max-w-[55%]", open ? "break-words" : "truncate", working && !waiting && "shimmer")}>{agent.title}</span>
        {agent.status === "failed" && <span className="shrink-0 text-detail text-destructive">Failed</span>}
        <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground opacity-55 transition-transform", open && "rotate-90 opacity-100")} />
        {right && <span className="ml-auto flex min-w-0 items-center gap-1.5 pl-3 text-detail text-muted-foreground">{right}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 pr-3 pb-3.5 pl-8">
          {agent.report ? (
            <div>
              <GroupLabel as="div" flush>
                What it found
              </GroupLabel>
              <Report text={agent.report} />
            </div>
          ) : (
            agent.status === "working" && streaming && <div className="text-detail text-muted-foreground">Its findings show here when it’s done.</div>
          )}
          {steps.length > 0 && <StepsPart parts={steps} active={working && !waiting} streaming={streaming} asks={asks} />}
        </div>
      )}
    </div>
  )
}

export function AgentsPart({
  id,
  agents,
  stepsOf,
  streaming,
  asks,
}: {
  // The block's element id, for the reply's last line to jump back to
  id: string
  agents: AgentPart[]
  stepsOf: (agentId: string) => StepPart[]
  streaming: boolean
  asks: StepAsks
}) {
  const working = streaming ? agents.filter((a) => a.status === "working") : []
  const live = working.length > 0
  const waiting = !!asks.waiting && agents.some((a) => stepsOf(a.agentId).some((p) => p.type === "tool_call" && p.toolCallId === asks.waiting))
  const [open, setOpen] = useState(live)
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current !== live) setOpen(live)
    wasLive.current = live
  }, [live])
  // Opened from elsewhere (the reply's last line), it shows
  useEffect(() => {
    const el = document.getElementById(id)
    const show = () => setOpen(true)
    el?.addEventListener("owlit:show", show)
    return () => el?.removeEventListener("owlit:show", show)
  }, [id])

  const done = agents.length - working.length
  let head: React.ReactNode
  if (waiting)
    head = (
      <>
        <WaitingLabel size="md">{agents.length === 1 ? "The agent is waiting on you" : "An agent is waiting on you"}</WaitingLabel>
        {agents.length > 1 && <span className="shrink-0 text-muted-foreground">· {done} of {agents.length} done</span>}
      </>
    )
  else if (agents.length === 1)
    head = (
      <>
        <span className={cn("truncate", live && "shimmer")}>{agents[0].title}</span>
        <span className="shrink-0 text-muted-foreground">· an agent</span>
      </>
    )
  else if (live)
    head = (
      <>
        <span className="truncate shimmer">{agents.length} agents working</span>
        {done > 0 && <span className="shrink-0 text-muted-foreground">· {done} done</span>}
      </>
    )
  else head = <span className="truncate">Worked with {agents.length} agents</span>

  return (
    <Collapsible id={id} open={open} onOpenChange={setOpen} className="group/agents scroll-mt-4">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1.5 text-sm text-foreground/80 outline-none hover:text-foreground focus-key:text-foreground">
          {head}
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/agents:rotate-90" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-hidden rounded-lg border">
          {agents.map((a) => (
            <AgentRow key={a.agentId} agent={a} steps={stepsOf(a.agentId)} streaming={streaming} asks={asks} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// The reply's last line while its agents work: how many are still at it (or that one waits on the user),
// with Show to jump back to their block, which may have scrolled far out of sight
export function AgentsWaitLine({ blockId, working, waiting }: { blockId: string; working: number; waiting: boolean }) {
  const show = () => {
    const el = document.getElementById(blockId)
    el?.dispatchEvent(new Event("owlit:show"))
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  return (
    <div className="flex items-center gap-1.5 text-sm text-foreground/80">
      {waiting ? (
        <>
          <WaitingShield size="md" />
          <span>An agent is waiting on you</span>
        </>
      ) : (
        <span className="shimmer">Waiting for {working === 1 ? "an agent" : `${working} agents`}</span>
      )}
      <Button variant="text" size="inline" onClick={show}>
        Show
      </Button>
    </div>
  )
}
