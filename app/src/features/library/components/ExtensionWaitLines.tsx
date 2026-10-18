import { useMemo } from "react"
import { WaitingDot } from "@/components/marks"
import { InlineLink } from "@/components/inline-link"
import { StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { useExtensionWaits } from "@/features/extension/store"
import { actOnWait, waitWords } from "@/features/extension/waits"
import { waitsOnYou } from "../lib/pdf-wait"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// At the top of the Library, one line per site the extension in the user's browser waits at: what it
// waits for, the papers there (which the count shows), and its one thing to do. Grey, on the ladder's
// working rung: nothing the user asked for is held up, and owlit goes on by itself once they are
// through. Amber, with the waiting dot, once they asked for one of its papers (waitsOnYou). It goes by
// itself when core says the site is through.
export function ExtensionWaitLines() {
  const waits = useExtensionWaits()
  const papers = useLibraryStore((s) => s.papers)
  const showOnly = useLibraryUi((s) => s.showOnly)
  // Each site's papers, read off the papers the extension holds there
  const bySite = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const p of Object.values(papers)) {
      const host = !p.pdf && p.pdfState?.extension?.waits ? p.pdfState.extension.host : undefined
      if (host) out.set(host, [...(out.get(host) ?? []), p.id])
    }
    return out
  }, [papers])
  if (!waits.length) return null
  return waits.map((wait) => {
    const words = waitWords(wait)
    const ids = bySite.get(wait.host) ?? []
    return (
      <StatusLine
        key={`${wait.kind}:${wait.host}`}
        mark={waitsOnYou(wait) ? <WaitingDot /> : null}
        actions={
          <Button variant="text" size="inline" onClick={() => void actOnWait(wait)}>
            {words.action}
          </Button>
        }
      >
        <span className="truncate">
          {words.what}
          {" · "}
          {ids.length ? <InlineLink onClick={() => showOnly(ids, words.what)}>{words.papers}</InlineLink> : words.papers}
        </span>
      </StatusLine>
    )
  })
}
