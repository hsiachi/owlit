import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { editStats, HUNK_GAP, type EditStats } from "@owlit/protocol"
import { hunk } from "@/features/docs/editor/suggestions"
import { libraryClient, useLibraryStore } from "@/features/library/store"
import type { MessagePart } from "../../types"
import { hostOf, type ToolCall } from "../../lib/step-words"

// What a step got, shown when its row is opened: a command's output, the hits of a search, the pages
// opened (a paper among them can go straight into the Library), a file's text, the change an edit made,
// the answers to a question. Kept short; the agent's own words are the answer.

type QuestionPart = Extract<MessagePart, { type: "question" }>

// The text a tool sent back, without the code fences Claude Code wraps it in
const plain = (content?: string) =>
  (content ?? "")
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim()

// What an agent the step handed work to sent back. Claude Code answers a background start with a notice
// meant only for its model ("Async agent launched successfully … never quote …", the agent's id, its
// output file): that is no result at all. A finished agent's answer ends with the same kind of lines
// (its id, its token usage), which are dropped.
function agentOutput(content?: string) {
  const text = plain(content)
  if (/^Async agent launched/.test(text)) return ""
  return text
    .replace(/<usage>[\s\S]*?<\/usage>/g, "")
    .split("\n")
    .filter((line) => !/^agentId: /.test(line.trim()))
    .join("\n")
    .trim()
}
const outputOf = (call: ToolCall) => (call.tool?.name === "Agent" || call.tool?.name === "Task" ? agentOutput(call.content) : plain(call.content))

const LIMIT = 4000
const clip = (s: string) => (s.length > LIMIT ? `${s.slice(0, LIMIT)}\n…` : s)

// A web search's hits, as Claude Code lists them: "Title (https://…)" a line
function hitsOf(content?: string) {
  const hits: { title: string; url: string }[] = []
  for (const line of plain(content).split("\n")) {
    const m = /^(.*?)\s*\((https?:\/\/[^\s)]+)\)\s*$/.exec(line.trim())
    if (m) hits.push({ title: m[1] || m[2], url: m[2] })
  }
  return hits
}

// A page that is a paper: on arXiv, or under a DOI
const isPaperUrl = (url: string) => /arxiv\.org\/(abs|pdf|html)\/|doi\.org\/10\.|\/doi\/(abs\/|full\/|pdf\/)?10\./.test(url)

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
    <button
      type="button"
      onClick={add}
      disabled={state === "adding"}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 outline-none group-hover/hit:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-key:bg-muted"
    >
      {state === "adding" ? "Adding…" : "Add to Library"}
    </button>
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

type Chunk =
  | { type: "same"; text: string }
  | { type: "gap" }
  | { type: "added"; text: string }
  | { type: "removed"; text: string }
  | { type: "change"; before: string; removed: string; added: string; after: string }

// Lines that differ between two texts (a longest-common-subsequence diff, enough for a note or a draft),
// with one line of context around each change. A line replaced by one line shows the words that changed.
export function diffLines(oldText: string, newText: string): Chunk[] {
  const a = oldText.split("\n").filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
  const b = newText.split("\n").filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
  if (a.length * b.length > 400_000) return [{ type: "added", text: b.join("\n") }]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const ops: { type: "same" | "added" | "removed"; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ type: "same", text: a[i++] })
      j++
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] > lcs[i + 1][j])) ops.push({ type: "added", text: b[j++] })
    else ops.push({ type: "removed", text: a[i++] })
  }
  const out: Chunk[] = []
  // A line kept for context sits right next to a change
  const near = (k: number) => [ops[k - 1], ops[k + 1]].some((o) => o && o.type !== "same")
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === "same") {
      if (!op.text.trim()) continue
      // Between two parts of an edit the agent reported apart
      if (op.text === HUNK_GAP) {
        if (out.length && out.at(-1)?.type !== "gap") out.push({ type: "gap" })
        continue
      }
      if (near(k)) out.push({ type: "same", text: op.text })
      else if (out.at(-1)?.type !== "gap" && out.length) out.push({ type: "gap" })
      continue
    }
    // A line out and the line that replaced it: the words that changed within it, when they share enough
    // at their ends to be read as one line rewritten
    const next = ops[k + 1]
    if (op.type === "removed" && next?.type === "added") {
      const h = hunk(op.text, next.text)
      const after = op.text.slice(h.at + h.removed.length)
      if (h.at + after.length >= Math.min(op.text.length, next.text.length) * 0.4) {
        out.push({ type: "change", before: op.text.slice(0, h.at), removed: h.removed, added: h.added, after })
        k++
        continue
      }
    }
    if (op.text.trim()) out.push({ type: op.type, text: op.text })
  }
  if (out.at(-1)?.type === "gap") out.pop()
  return out
}

// "+1,240 −380": what an edit added and took out, in words for prose; lines elsewhere carry their unit
// ("+12 −3 lines"), so the two never read as one measure
export const countsText = ({ unit, added, removed }: EditStats) => {
  const counts = [added && `+${added.toLocaleString()}`, removed && `−${removed.toLocaleString()}`].filter(Boolean).join(" ")
  return counts && unit === "lines" ? `${counts} ${added + removed === 1 ? "line" : "lines"}` : counts
}

// The muted detail at a row's right end, when the step's result has one worth seeing at a glance
export function stepMeta(call: ToolCall): string | undefined {
  if (call.status !== "completed") return undefined
  const name = call.tool?.name
  if (name === "WebSearch" || (!name && /^Search "/.test(call.title))) {
    const n = hitsOf(call.content).length
    return n ? `${n} results` : undefined
  }
  if (name === "WebFetch" || (!name && /^Fetch /.test(call.title))) return hostOf(call.tool?.url ?? call.title.replace(/^Fetch /, "").split(" ")[0])
  if (call.diff) {
    // Only the parts the agent reported, so never "Rewritten": that is said of the whole file, in the result card
    return countsText(editStats(call.diff.path, call.diff.oldText, call.diff.newText)) || undefined
  }
  return undefined
}

export function hasResult(call: ToolCall, question?: QuestionPart) {
  return !!question?.answers || !!call.diff || !!outputOf(call) || !!call.tool?.command || (call.kind === "execute" && !call.tool)
}

export function StepResult({ call, question }: { call: ToolCall; question?: QuestionPart }) {
  const name = call.tool?.name
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
  const output = clip(outputOf(call))
  // A command: what ran, then what it printed
  if (name === "Bash" || (!call.tool && call.kind === "execute")) {
    const command = call.tool?.command ?? call.title
    return (
      <div className="flex flex-col gap-1.5">
        <Pre className="text-foreground">{`$ ${command}`}</Pre>
        {output && <Pre>{output}</Pre>}
      </div>
    )
  }
  if (name === "WebSearch" || (!name && /^Search "/.test(call.title))) {
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
  if (name === "WebFetch" || (!name && /^Fetch /.test(call.title))) {
    const url = call.tool?.url ?? call.title.replace(/^Fetch /, "").split(" ")[0]
    return (
      <div className="flex flex-col gap-1.5">
        <Hit title={url} url={url} detail="" />
        {output && <p className="text-detail leading-relaxed whitespace-pre-wrap text-muted-foreground">{output}</p>}
      </div>
    )
  }
  return output ? <Pre>{output}</Pre> : null
}
