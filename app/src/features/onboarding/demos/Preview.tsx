import { useState } from "react"
import { Input } from "@/components/ui/input"
import { AskDemo, GreetingDemo, HelloDemo, LibraryPreview, MiniWindow, ReadDemo, RememberDemo, WriteDemo, type DemoPlace } from "."

// A throwaway sheet of every demo side by side, each in its own window, to look at them while the flow is
// being built; plus one window that steps through them, as the flow will. Not part of the app.
export function DemosPreview() {
  const [name, setName] = useState("")
  const [step, setStep] = useState(0)
  const agentName = "Claude Code" // i18n-ignore
  const steps: { place: DemoPlace; node: React.ReactNode }[] = [
    { place: "library", node: <ReadDemo key="read" /> },
    { place: "docs", node: <WriteDemo key="write" /> },
    { place: "chat", node: <AskDemo key="ask" /> },
    { place: "knowledge", node: <RememberDemo key="remember" /> },
    { place: "chat", node: <GreetingDemo key="you" name={name} agentName={agentName} /> },
    { place: "chat", node: <HelloDemo key="agent" name={name} agentName={agentName} /> },
    { place: "library", node: <LibraryPreview key="look" /> },
  ]
  return (
    <div className="flex flex-col gap-6 overflow-auto bg-background p-6">
      <div className="flex items-center gap-3">
        {/* i18n-ignore: a throwaway preview */}
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" aria-label="Name" />
        <button type="button" className="rounded-md bg-muted px-3 py-1" onClick={() => setStep((i) => (i + 1) % steps.length)}>
          {"→"} {step + 1}
        </button>
      </div>
      <MiniWindow place={steps[step].place}>{steps[step].node}</MiniWindow>
      <div className="flex flex-wrap gap-6">
        {steps.map((x, i) => (
          <MiniWindow key={i} place={x.place}>
            {x.node}
          </MiniWindow>
        ))}
      </div>
    </div>
  )
}
