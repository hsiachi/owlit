import { baseName } from "./naming.ts"

// Projects: a folder of the workspace is a project when it holds a project.md (any case), at any depth.
// Nothing about a project is stored outside that file; core computes the rest from the workspace each time.

// The file that marks its folder as a project
export const PROJECT_MARK = "project.md"

export const isProjectMark = (path: string) => baseName(path).toLowerCase() === PROJECT_MARK

// A project's path as two spellings of it compare: without slashes around it and composed, since a path
// typed on macOS can come decomposed; "" for none
export const projectKey = (path: string | undefined) => (path ?? "").trim().replace(/^\/+|\/+$/g, "").normalize("NFC")

export type ProjectStatus = "active" | "done"

export interface Project {
  // The marked folder: workspace-relative, "/"-separated, never "" (the workspace itself is no project)
  path: string
  // The mark file itself, as it is spelled on disk ("Proactive/Project.md")
  mark: string
  // The mark's first "# " heading, else the folder's name
  name: string
  status?: ProjectStatus
  // As the mark writes it, YYYY-MM-DD
  due?: string
  // The doc the mark's current: line names as the current draft of its kind (written relative to the
  // project's folder), given here workspace-relative
  current?: string
  // The marked folders above this one, nearest first: a nested project's lineage
  parents: string[]
  // The current draft of each kind of doc in it (core's projects/projects.ts says what a kind is), newest
  // first
  currentDrafts: CurrentDraft[]
}

export interface CurrentDraft {
  // The doc's name without its version: "研究故事" for 研究故事-v3-委托提醒.md
  kind: string
  // Workspace-relative
  path: string
  modifiedAt: number
  // Named by the mark's current: line rather than being the newest of its kind
  byMark?: true
}
