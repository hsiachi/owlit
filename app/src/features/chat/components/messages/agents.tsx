import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { FadeClip, ShowAllButton } from "@/components/fade-clip"
import { GroupLabel } from "@/components/group-label"
import { WaitingLabel } from "@/components/marks"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import type { Part } from "../../types"
import { agentDone, agentNow, type ToolCall } from "../../lib/step-words"
import { Markdown } from "./Markdown"
import { StepsPart, type StepAsks, type StepPart } from "./parts"
import { FoldingBlock, FoldingList, StepChevron, StepRow } from "./folding"
import { useOpenWhile } from "./use-open-while"

export type AgentPart = Part<"agent">

// The agents the answering agent handed parts of the work to at one point of the answer, as one block where
// they were handed out. It reads like a plan: open while they work, folded into one line once all are done.
// Each agent is a row named by its task; its steps never mix into the answer's own. A row opens to the
// report the agent handed back, then its own steps as an ordinary steps block.

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
  const calls = steps.filter((p): p is ToolCall => p.type === "tool_call")
  const waiting = !!asks.waiting && calls.some((c) => c.toolCallId === asks.waiting)
  const working = agent.status === "working" && streaming
  let right: React.ReactNode
  if (waiting) right = <WaitingLabel />
  else if (working) right = <span className="truncate">{agentNow(calls, steps.at(-1)?.type === "thought")}</span>
  else if (agent.status === "stopped" || (agent.status === "working" && !streaming)) right = "Stopped"
  else if (agent.status === "done") right = agentDone(calls)
  return (
    <div className="border-t first:border-t-0">
      <StepRow open={open} onToggle={() => setOpen((o) => !o)} className="min-h-10 text-foreground/80">
        {/* While it works its task shimmers; the step it is at stays plain at the right */}
        <span className={cn("min-w-0 shrink-0 max-w-[55%]", open ? "break-words" : "truncate", working && !waiting && "shimmer")}>{agent.title}</span>
        {agent.status === "failed" && <span className="shrink-0 text-detail text-destructive">Failed</span>}
        <StepChevron open={open} className="text-muted-foreground" />
        {right && <span className="ml-auto flex min-w-0 items-center gap-1.5 pl-3 text-detail text-muted-foreground">{right}</span>}
      </StepRow>
      <Unfold open={open}>
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
      </Unfold>
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
  const [open, setOpen] = useOpenWhile(live)
  // Opened from elsewhere (the reply's last line), it shows
  useEffect(() => {
    const el = document.getElementById(id)
    const show = () => setOpen(true)
    el?.addEventListener("owlit:show", show)
    return () => el?.removeEventListener("owlit:show", show)
  }, [id, setOpen])

  const done = agents.length - working.length
  let head: React.ReactNode
  if (waiting)
    head = (
      <>
        <WaitingLabel>{agents.length === 1 ? "The agent is waiting on you" : "An agent is waiting on you"}</WaitingLabel>
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
    <FoldingBlock id={id} open={open} onOpenChange={setOpen} head={head} className="scroll-mt-4">
      <FoldingList>
        {agents.map((a) => (
          <AgentRow key={a.agentId} agent={a} steps={stepsOf(a.agentId)} streaming={streaming} asks={asks} />
        ))}
      </FoldingList>
    </FoldingBlock>
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
        <span>An agent is waiting on you</span>
      ) : (
        <span className="shimmer">Waiting for {working === 1 ? "an agent" : `${working} agents`}</span>
      )}
      <Button variant="text" size="inline" onClick={show}>
        Show
      </Button>
    </div>
  )
}
