import { projectKey, type Project } from "@owlit/protocol"
import { create } from "zustand"
import { followCore } from "@/lib/follow-core"
import { onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"

// The workspace's projects, the folders marked by a project.md, as core works them out: read when a
// workspace opens and replaced whole by every projects.changed.

interface ProjectsState {
  projects: Project[]
  // Whether the list has arrived: until then a thread's project isn't taken for gone
  loaded: boolean
}

export const useProjectsStore = create<ProjectsState>()(() => ({ projects: [], loaded: false }))

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

onWorkspaceOpened(() => {
  useProjectsStore.setState({ projects: [], loaded: false })
  void follow.load().catch(() => undefined)
})

onNotify("projects.changed", ({ projects }) => follow.hear(() => useProjectsStore.setState({ projects, loaded: true })))
