import { t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { desktopOnly } from "../runs"
import { put } from "../store"

// At most this many sentences in one comparison: each becomes a group when the table is grouped by them
const MOST = 12

// A doc's sentences, as the user might want them weighed: its lines split at sentence ends, headings and
// list marks taken off, very short pieces left out
function sentencesOf(markdown: string): string[] {
  const out: string[] = []
  for (const raw of markdown.split("\n")) {
    const line = raw
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim()
    if (!line) continue
    for (const piece of line.split(/(?<=[.!?。！？])\s*/)) {
      const s = piece.trim()
      if (s.length >= 12) out.push(s)
    }
  }
  return out
}

// Compare with a doc…: the user picks a doc of theirs, then the sentences to set every paper against.
// The column is theirs; Owlit fills it in the background.
export function CompareDialog({ collectionId, open, onOpenChange }: { collectionId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const files = useDocsStore((s) => s.files)
  const docs = useMemo(
    () =>
      Object.values(files)
        .filter((f) => /\.(md|markdown)$/i.test(f.path))
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    [files],
  )
  const [doc, setDoc] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const file = useMemo(() => docs.find((f) => f.path === doc), [docs, doc])
  const sentences = useMemo(() => (file?.content ? sentencesOf(file.content) : []), [file])
  const close = () => {
    onOpenChange(false)
    setDoc(null)
    setPicked([])
  }
  const compare = async () => {
    if (!doc || !picked.length) return
    if (!isDesktop) {
      desktopOnly()
      return close()
    }
    try {
      put(await rpc.collections.compare({ id: collectionId, doc, sentences: picked }))
      close()
    } catch (error) {
      toastError(error)
    }
  }
  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : p.length < MOST ? [...p, s] : p))
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeading
          title={file ? t`Which sentences of ${displayName(file.path)}?` : t`Compare with a doc`}
          about={t`Owlit says for every paper whether it supports, challenges or relates to the sentences you pick. They stay as you wrote them.`}
        />
        <div className="-mx-2 max-h-80 overflow-y-auto">
          {!file ? (
            docs.length ? (
              docs.map((f) => (
                <button key={f.id} type="button" onClick={() => setDoc(f.path)} className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent focus-key:bg-accent">
                  <span className="truncate">{displayName(f.path)}</span>
                  <span className="ml-auto pl-3 text-detail text-muted-foreground">{f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") : ""}</span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{t`There are no docs in this workspace yet.`}</p>
            )
          ) : (
            sentences.map((s) => (
              <label key={s} className={cn("flex cursor-default gap-2.5 rounded-lg px-2.5 py-2 text-sm leading-relaxed hover:bg-accent", picked.includes(s) && "bg-muted")}>
                <Checkbox checked={picked.includes(s)} onCheckedChange={() => toggle(s)} className="mt-0.5" />
                <span>{s}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          {file && (
            <Button variant="ghost" className="mr-auto font-normal text-muted-foreground" onClick={() => (setDoc(null), setPicked([]))}>
              {t`Another doc`}
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            {t`Cancel`}
          </Button>
          <Button disabled={!picked.length} onClick={() => void compare()}>
            {t`Compare`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
