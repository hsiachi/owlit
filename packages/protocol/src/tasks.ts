// Background work core does on its own: fetching metadata and PDFs, extracting text, indexing,
// agent runs. Tasks are kept per workspace in owlit's data folder (not in the workspace) and survive
// restarts; their state shows beside what they are about (a paper's row, the import line), never in a
// task list of its own.

// Each lane runs a fixed number of tasks at once: network 3, browser 1, cpu 2, parse as the service
// allows, agent 1, index 1
export type TaskLane = "network" | "browser" | "cpu" | "parse" | "agent" | "index"

// Someone is looking at the result > the user asked for it > owlit started it on its own
export type TaskPriority = "waiting" | "asked" | "background"

export type TaskState = "queued" | "running" | "waiting_for_you" | "done" | "failed" | "cancelled"

// What the user has to do before the task can go on. A state shown beside the subject, not a dialog.
// browser: their own browser may be showing them something (a check, a question about downloads).
export interface TaskWaiting {
  reason: "login" | "challenge" | "drop_pdf" | "confirm_spend" | "browser"
  // One sentence a person can read
  detail: string
}

// A job handed to an outside service (MinerU). Recorded before the service is asked to start, so
// after a restart the task looks the job up instead of paying for a second one.
export interface ExternalJob {
  service: string
  jobId: string
  at: number
}

export interface Task {
  id: string
  // paper.metadata | paper.pdf | paper.text | paper.parse | paper.digest | index.* | import.* | collections.* | …
  kind: string
  // What it works on: a paper id, a file path, an import batch id, "workspace"
  subject: string
  // The batch this task belongs to (an import's papers)
  parent?: string
  lane: TaskLane
  priority: TaskPriority
  state: TaskState
  progress?: { done: number; total?: number; note?: string }
  waiting?: TaskWaiting
  // Runs started, counting retries
  attempts: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  // Why it failed, or why it is about to be retried
  error?: string
  // Not to start before this time: a debounce or a retry's backoff
  notBefore?: number
  // Queued behind another task that produces what this one needs
  blockedOn?: string
  external?: ExternalJob
}

export const TASK_PRIORITIES: readonly TaskPriority[] = ["waiting", "asked", "background"]

export const isTaskFinished = (task: Pick<Task, "state">) =>
  task.state === "done" || task.state === "failed" || task.state === "cancelled"
