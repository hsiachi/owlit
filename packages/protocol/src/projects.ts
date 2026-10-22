import type { ReadFrom } from "./chat.ts"

// Projects: a folder of the workspace is a project when it holds a project.md (any case), at any depth.
// Nothing about a project is stored outside that file; core computes the rest from the workspace each time.

// The file that marks its folder as a project
export const PROJECT_MARK = "project.md"

// The base name is cut here rather than by naming.ts's baseName: naming.ts asks this, and the two importing
// each other would be a cycle
export const isProjectMark = (path: string) => path.slice(path.lastIndexOf("/") + 1).toLowerCase() === PROJECT_MARK

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

// projects.cited: the Library's papers a project cites, the papers being in it by reference only. Found in
// the docs' text as it is on disk, so it agrees with the doc a link opens.
export interface ProjectCited {
  // Cited in the project's current drafts
  drafts: CitedPaper[]
  // Cited in any doc under the project, its sub-projects' included; drafts' papers among them
  all: CitedPaper[]
}

export interface CitedPaper {
  // The Library's id
  id: string
  // The docs under the project citing it, its current drafts first
  docs: string[]
  // The deepest Owlit had read the paper for any of its citations in those docs that it wrote; absent
  // when none says
  depth?: ReadFrom["depth"]
  // The other projects whose docs cite it, each its nearest mark; the project's own sub-projects aren't
  // other
  also: { path: string; name: string }[]
}

// projects.summary: what Home shows of each project, and the unmarked folders the person worked in lately.
// "Lately" is the person's own last few working sessions (core's projects/summary.ts), never the clock.
export interface ProjectsSummary {
  // How many working sessions the person's journal holds
  sessions: number
  // Every project, by path
  projects: ProjectSummary[]
  // Folders at the top of the workspace, in no project, holding a doc the person worked on lately (as
  // live counts work): the newest such doc and when; newest first
  folders: { path: string; doc: string; lastWorked: number }[]
}

export interface ProjectSummary {
  path: string
  name: string
  status?: ProjectStatus
  due?: string
  // The person worked on it lately, and it isn't done. Their work is what they asked for, not only what
  // they typed: they edited one of its docs, wrote in a chat that is in it, or Owlit edited one of its docs
  // in a chat the person started.
  live: boolean
  // The doc in it the person last edited or had Owlit edit (by: "owlit"), else its newest current draft
  // (draft: at is then its mtime, whoever wrote it). A chat makes a project live but names no doc here.
  lastWorked?: { path: string; at: number; draft?: true; by?: "owlit" }
  // When the person last worked on it, their chats in their latest sessions included; absent when never
  workedAt?: number
  // On its current drafts: open comments, Owlit's changes the person hasn't had on screen, and the papers
  // they cite that owlit tried and failed to get a PDF of; with the draft to open for the first two
  waits: { comments: number; proposals: number; noPdf: number; commentsIn?: string; proposalsIn?: string }
  // How many of its docs someone else changed since the person last had them on screen, and the newest
  changed: number
  changedIn?: string
}
