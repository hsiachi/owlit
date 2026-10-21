import { useEffect, useState } from "react"
import type { DocCitations } from "@owlit/protocol"
import { rpc } from "@/lib/rpc"
import { useDocsStore } from "../store"

// How long the doc's text rests before its citations are asked again: typing never asks on every key
const SETTLE_MS = 800

// A doc's citations as core keeps them (docs.citations), for the text the window has: asked when the doc
// opens and again once its text has rested after a change (the person's typing, Owlit's edit coming in).
// null until core first answers, or when it can't.
export function useDocCitations(fileId: string): DocCitations | null {
  const path = useDocsStore((s) => s.files[fileId]?.path)
  const text = useDocsStore((s) => s.files[fileId]?.content)
  const [citations, setCitations] = useState<{ fileId: string; value: DocCitations } | null>(null)
  useEffect(() => {
    if (!path || text === undefined) return
    let live = true
    const timer = setTimeout(
      () =>
        void rpc.docs.citations({ path, text }).then(
          (value) => live && setCitations({ fileId, value }),
          () => undefined,
        ),
      SETTLE_MS,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [fileId, path, text])
  return citations?.fileId === fileId ? citations.value : null
}
