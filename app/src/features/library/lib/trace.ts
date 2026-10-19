import { t } from "@lingui/core/macro"
import { useCallback, useState } from "react"
import type { Paper, ReadTrace } from "@owlit/protocol"
import { rpc } from "@/lib/rpc"

// How far the person got with a paper, said on hover of its status: "12 min, pp. 1–6", "the digest,
// 3 min", "Not opened here". Core sums it from the journal (library.trace); the status is the state, so a
// paper's word is asked again once its status or last-read time moves.

// "12 min, pp. 1–6 · the digest, 3 min"; "" when nothing was timed
export function traceDetail(trace: Pick<ReadTrace, "pdfSeconds" | "digestSeconds" | "pages">): string {
  const parts: string[] = []
  if (trace.pdfSeconds) {
    const time = duration(trace.pdfSeconds)
    const pages = pageRanges(trace.pages)
    parts.push(pages ? t({ message: `${time}, ${pages}`, comment: "time spent in a paper, then the pages read, e.g. 12 min, pp. 1–6" }) : time)
  }
  if (trace.digestSeconds) {
    const time = duration(trace.digestSeconds)
    parts.push(t({ message: `the digest, ${time}`, comment: "time spent reading Owlit's digest of a paper, e.g. the digest, 3 min" }))
  }
  return parts.join(" · ")
}

export function traceTitle(trace: ReadTrace): string {
  if (trace.state === "none") return t`Not opened here`
  const detail = traceDetail(trace)
  if (trace.state === "read") return detail ? t({ message: `Read · ${detail}`, comment: "a paper's reading status, then how long it was read" }) : ""
  return detail
}

function duration(seconds: number) {
  if (seconds < 60) return t`under a minute`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t`${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? t`${hours} h ${rest} min` : t`${hours} h`
}

// [1, 2, 3, 5] → "pp. 1–3, 5"; one page → "p. 4"
function pageRanges(pages: readonly number[]) {
  if (!pages.length) return ""
  const runs: string[] = []
  for (let i = 0; i < pages.length; i++) {
    let j = i
    while (pages[j + 1] === pages[j] + 1) j++
    runs.push(j > i ? `${pages[i]}–${pages[j]}` : String(pages[i]))
    i = j
  }
  const list = runs.join(", ")
  return pages.length === 1 ? t`p. ${list}` : t`pp. ${list}`
}

const cache = new Map<string, { key: string; title: string }>()
const keyOf = (p: Paper) => `${p.status}|${p.lastOpenedAt ?? 0}`

// The status's hover text for a paper, asked of core the first time the pointer or focus reaches it.
// Without core (the browser preview) only an unread paper has something to say.
export function useTraceTitle(paper: Paper) {
  const key = keyOf(paper)
  const cached = cache.get(paper.id)
  const [, redraw] = useState(0)
  const ask = useCallback(() => {
    if (cache.get(paper.id)?.key === key) return
    void rpc.library
      .trace({ ids: [paper.id] })
      .then((traces) => traces[paper.id])
      .catch((): ReadTrace => ({ state: paper.status === "read" ? "read" : paper.status === "reading" ? "looked" : "none", pdfSeconds: 0, digestSeconds: 0, pages: [] }))
      .then((trace) => {
        if (!trace) return
        cache.set(paper.id, { key, title: traceTitle(trace) })
        redraw((n) => n + 1)
      })
  }, [paper.id, paper.status, key])
  return { title: cached?.key === key ? cached.title || undefined : undefined, ask }
}
