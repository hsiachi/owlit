import { projectKey, type Project, type ProjectsSummary } from "@owlit/protocol"
import { create } from "zustand"
import { followCore } from "@/lib/follow-core"
import { onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { useLogVersion } from "@/app/seen"
import { useChatStore } from "@/features/chat/store"

// The workspace's projects, the folders marked by a project.md, as core works them out: read when a
// workspace opens and replaced whole by every projects.changed. Home's summary of them is asked again
// whenever what it counts can have changed.

interface ProjectsState {
  projects: Project[]
  // Whether the list has arrived: until then a thread's project isn't taken for gone
  loaded: boolean
  // What Home shows of each (projects.summary); null until it has come
  summary: ProjectsSummary | null
}

export const useProjectsStore = create<ProjectsState>()(() => ({ projects: [], loaded: false, summary: null }))

// The marked projects, by path
export const useProjects = () => useProjectsStore((s) => s.projects)

// The project at a marked folder's path, however it is spelled; undefined for "" or a path that is no project
export const projectAt = (projects: Project[], path: string) => (projectKey(path) ? projects.find((p) => projectKey(p.path) === projectKey(path)) : undefined)

// The projects as a menu or a list of groups names them: by name, a name two projects share given as each
// one's path instead, so every choice reads differently; sorted by that label
export function projectChoices(projects: Project[]) {
  const shared = new Set(projects.filter((p, i) => projects.findIndex((q) => q.name === p.name) !== i).map((p) => p.name))
  return projects.map((project) => ({ project, label: shared.has(project.name) ? project.path : project.name })).sort((a, b) => a.label.localeCompare(b.label))
}

const follow = followCore({
  read: async () => (await rpc.projects.list()).projects,
  take: (projects) => useProjectsStore.setState({ projects, loaded: true }),
})

// The summary reads every project's docs, comments and the journal: asked once things settle,
// not on each of a burst of changes (a turn writing several docs, typing saved every few seconds)
const SUMMARY_SETTLE_MS = 500
let summaryTimer: ReturnType<typeof setTimeout> | undefined
// Counts the asks: an answer overtaken by a later ask, or by another workspace, is dropped
let summaryAsks = 0

export function refreshSummary() {
  clearTimeout(summaryTimer)
  summaryTimer = setTimeout(() => {
    const ask = ++summaryAsks
    rpc.projects.summary().then(
      (summary) => ask === summaryAsks && useProjectsStore.setState({ summary }),
      () => undefined,
    )
  }, SUMMARY_SETTLE_MS)
}

onWorkspaceOpened(() => {
  summaryAsks++
  useProjectsStore.setState({ projects: [], loaded: false, summary: null })
  void follow.load().catch(() => undefined)
  refreshSummary()
})

onNotify("projects.changed", ({ projects }) => {
  follow.hear(() => useProjectsStore.setState({ projects, loaded: true }))
  refreshSummary()
})
// The change log grew (an edit, a comment, Owlit's write), a turn ended, a mark of what the person saw moved,
// a paper got or lost its PDF
useLogVersion.subscribe(refreshSummary)
useChatStore.subscribe((s, prev) => s.streaming !== prev.streaming && Object.keys(prev.streaming).some((id) => !s.streaming[id]) && refreshSummary())
for (const topic of ["chats.turn", "seen.changed", "comments.changed", "library.changed"] as const) onNotify(topic, refreshSummary)
