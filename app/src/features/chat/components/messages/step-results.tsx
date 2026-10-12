import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { libraryClient, useLibraryStore } from "@/features/library/store"
import type { QuestionPart } from "../../types"
import { diffLines } from "../../lib/diff-lines"
import { hitsOf, isPaperUrl, outputOf } from "../../lib/step-output"
import { fetchUrlOf, hostOf, runsCommand, stepGroup, type ToolCall } from "../../lib/step-words"

// What a step got, shown when its row is opened: a command's output, the hits of a search, the pages
// opened (a paper among them can go straight into the Library), a file's text, the change an edit made,
// the answers to a question. Kept short; the agent's own words are the answer.

function AddToLibrary({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "adding" | "added">("idle")
  const add = async () => {
    setState("adding")
    try {
      const resolved = await libraryClient.resolve(url)
      if (resolved.existingId) {
        toast("Already in your Library")
      } else {
        useLibraryStore.getState().addPaper(resolved)
        toast(`Added “${resolved.title}”`)
      }
      setState("added")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add that paper.")
      setState("idle")
    }
  }
  if (state === "added") return <span className="shrink-0 text-xs text-muted-foreground">In Library</span>
  return (
    <Button variant="text" size="inline" onClick={add} disabled={state === "adding"} className="opacity-0 group-hover/hit:opacity-100 focus-visible:opacity-100">
      {state === "adding" ? "Adding…" : "Add to Library"}
    </Button>
  )
}

function Hit({ title, url, detail }: { title: string; url: string; detail?: string }) {
  return (
    <div className="group/hit flex min-w-0 items-baseline gap-2 py-0.5">
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-foreground hover:underline" title={url}>
        {title}
      </a>
      <span className="shrink-0 text-xs text-muted-foreground">{detail ?? hostOf(url)}</span>
      {isPaperUrl(url) && <span className="ml-auto" />}
      {isPaperUrl(url) && <AddToLibrary url={url} />}
    </div>
  )
}

const Pre = ({ children, className }: { children: string; className?: string }) => (
  <pre className={cn("font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground", className)}>{children}</pre>
)

// An edit's marks, as the doc draws them before it is applied: new words in Owlit's colour, underlined;
// removed words muted with a strike in it
const Added = ({ children, className }: { children: string; className?: string }) => (
  <ins className={cn("text-suggestion underline decoration-suggestion decoration-1 underline-offset-3", className)}>{children}</ins>
)
const Removed = ({ children }: { children: string }) => (
  <del className="text-muted-foreground line-through decoration-suggestion decoration-[1.5px]">{children}</del>
)

// The part of a file an edit changes, read as prose: what it adds and what it takes out, with a line of
// the text around each change
export function DiffPreview({ oldText, newText, className }: { oldText: string; newText: string; className?: string }) {
  const chunks = diffLines(oldText, newText)
  return (
    <div className={cn("flex flex-col gap-1.5 text-detail leading-relaxed", className)}>
      {chunks.map((c, i) =>
        c.type === "same" ? (
          <p key={i} className="text-muted-foreground whitespace-pre-wrap">
            {c.text}
          </p>
        ) : c.type === "gap" ? (
          <p key={i} className="text-muted-foreground">
            …
          </p>
        ) : c.type === "change" ? (
          <p key={i} className="whitespace-pre-wrap">
            {c.before}
            {c.removed && <Removed>{c.removed}</Removed>}
            {c.added && <Added className={c.removed ? "ml-[0.25em]" : undefined}>{c.added}</Added>}
            {c.after}
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {c.type === "added" ? <Added>{c.text}</Added> : <Removed>{c.text}</Removed>}
          </p>
        ),
      )}
    </div>
  )
}

export function StepResult({ call, question }: { call: ToolCall; question?: QuestionPart }) {
  // The questions and what was answered, as prose: the question muted, the answer in the text colour
  if (question?.answers) {
    return (
      <div className="flex flex-col gap-1.5">
        {question.questions.map((q) => {
          const a = question.answers?.[q.id]
          const said = [...(a?.picks ?? []), ...(a?.text ? [a.text] : [])].join(" · ")
          return (
            <div key={q.id}>
              <div className="text-muted-foreground">{q.question}</div>
              <div>{said || "No answer"}</div>
            </div>
          )
        })}
      </div>
    )
  }
  if (call.diff) return <DiffPreview oldText={call.diff.oldText} newText={call.diff.newText} />
  const output = outputOf(call)
  // A command: what ran, then what it printed
  if (runsCommand(call)) {
    const command = call.tool?.command ?? call.title
    return (
      <div className="flex flex-col gap-1.5">
        <Pre className="text-foreground">{`$ ${command}`}</Pre>
        {output && <Pre>{output}</Pre>}
      </div>
    )
  }
  const group = stepGroup(call)
  if (group === "web") {
    const hits = hitsOf(call.content)
    if (hits.length)
      return (
        <div className="flex flex-col">
          {hits.map((h) => (
            <Hit key={h.url} title={h.title} url={h.url} />
          ))}
        </div>
      )
  }
  const url = group === "fetch" ? fetchUrlOf(call) : undefined
  if (url) {
    return (
      <div className="flex flex-col gap-1.5">
        <Hit title={url} url={url} detail="" />
        {output && <p className="text-detail leading-relaxed whitespace-pre-wrap text-muted-foreground">{output}</p>}
      </div>
    )
  }
  return output ? <Pre>{output}</Pre> : null
}
