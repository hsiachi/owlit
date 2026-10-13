import { t } from "@lingui/core/macro"
import { useEffect, useMemo } from "react"
import { EmptyPlace } from "@/components/empty-place"
import { PageShell } from "@/components/page"
import { LibraryHeader } from "../components/LibraryHeader"
import { PaperList } from "../components/PaperList"
import { upNext } from "../lib/filter"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

export function UpNextPage() {
  const papers = useLibraryStore((s) => s.papers)
  const groups = useMemo(() => upNext(papers), [papers])
  const order = useMemo(() => groups.flatMap((g) => g.papers.map((p) => p.id)), [groups])
  const { scroller, onKeyDown } = usePaperListKeys(order)
  // As on All papers: a peek opened here folds when the page is left
  useEffect(() => () => useLibraryUi.getState().closePeek(), [])
  return (
    <PageShell scroller={scroller} onKeyDown={onKeyDown}>
      <LibraryHeader />
      {groups.length ? (
        <div className="mt-6">
          <PaperList groups={groups} order={order} />
        </div>
      ) : (
        <EmptyPlace title={t`Nothing to read next`} detail={t`Papers you start reading, and new ones with a PDF, will show up here.`} className="mt-20" />
      )}
    </PageShell>
  )
}
