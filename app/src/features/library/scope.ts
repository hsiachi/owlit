import { useEffect, useMemo } from "react"
import { create } from "zustand"
import { projectKey, type CitedPaper, type ProjectCited } from "@owlit/protocol"
import { onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { useDocsStore } from "@/features/docs/store"
import { projectAt, useProjectsStore } from "@/features/projects/store"
import { useLibraryUi } from "./ui-store"

// The papers of the Library's scope, as core finds them in the project's docs (projects.cited). Asked when
// the scope is set and again, once things settle, after the docs, the Library or the marks changed; only
// while a list shows the scope, the rest of the time it is only noted as stale.

interface ScopeState {
  // The project the answer is for; null when none was asked yet
  path: string | null
  cited: ProjectCited | null
}

const useScopeCited = create<ScopeState>()(() => ({ path: null, cited: null }))

// Edits come in bursts (a turn writing several docs, typing saved every few seconds)
const SETTLE_MS = 500
let timer: ReturnType<typeof setTimeout> | undefined
// Counts the asks: an answer overtaken by a later ask, or by another workspace, is dropped
let asks = 0
// Lists showing the scope now
let watching = 0
let stale = true

function ask(delay: number) {
  clearTimeout(timer)
  const scope = useLibraryUi.getState().scope
  if (!scope) return
  if (!watching) {
    stale = true
    return
  }
  timer = setTimeout(() => {
    const mine = ++asks
    stale = false
    rpc.projects.cited({ path: scope.project }).then(
      (cited) => mine === asks && useScopeCited.setState({ path: scope.project, cited }),
      () => undefined,
    )
  }, delay)
}

// A scope whose project went (its mark removed or moved) goes too, and the whole Library shows
function dropGone() {
  const { projects, loaded } = useProjectsStore.getState()
  const scope = useLibraryUi.getState().scope
  if (scope && loaded && !projectAt(projects, scope.project)) useLibraryUi.getState().setScope(null)
}

onWorkspaceOpened(() => {
  asks++
  clearTimeout(timer)
  stale = true
  useScopeCited.setState({ path: null, cited: null })
  useLibraryUi.getState().setScope(null)
})
useLibraryUi.subscribe((s, prev) => {
  if (s.scope?.project === prev.scope?.project) return
  stale = true
  ask(0)
})
useProjectsStore.subscribe((s, prev) => {
  if (s.projects === prev.projects) return
  dropGone()
  ask(SETTLE_MS)
})
// A doc came, went, moved or was written: its path or mtime changed, not only the text the window holds
let docsStamp = ""
useDocsStore.subscribe((s, prev) => {
  if (s.files === prev.files) return
  const stamp = Object.values(s.files)
    .map((f) => `${f.path}:${f.modifiedAt}`)
    .join("|")
  if (stamp === docsStamp) return
  docsStamp = stamp
  ask(SETTLE_MS)
})
onNotify("library.changed", () => ask(SETTLE_MS))

// The scope's papers for a list that shows them: ids is null without a scope, and empty until core first
// answers for it (loading); byId has each one's docs, Owlit's depth and the other projects citing it
export function useScopePapers() {
  const scope = useLibraryUi((s) => s.scope)
  const answer = useScopeCited()
  useEffect(() => {
    watching++
    if (stale) ask(0)
    return () => {
      watching--
    }
  }, [])
  const current = !!scope && answer.path !== null && projectKey(answer.path) === projectKey(scope.project) ? answer.cited : null
  return useMemo(() => {
    if (!scope) return { scope, ids: null, byId: null, loading: false, all: 0 }
    const list: CitedPaper[] = current ? (scope.drafts ? current.drafts : current.all) : []
    return {
      scope,
      ids: new Set(list.map((p) => p.id)),
      byId: new Map(list.map((p) => [p.id, p])),
      loading: !current,
      // How many papers the step to everything it cites would show
      all: current?.all.length ?? 0,
    }
  }, [scope, current])
}
