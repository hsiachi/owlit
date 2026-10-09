import { isTaskFinished, type Task } from "@owlit/protocol"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"

interface OpenFile {
  version: 1
  tasks: Task[]
}

// <workspace data dir>/tasks/: log.jsonl gets one line per change of state (the history, for looking
// back and for recovery); open.json holds the unfinished tasks whole and is what a restart reads.
// Writes happen in order, batched while one is in flight.
export class TaskStore {
  private readonly logFile: string
  private readonly openFile: string
  private lines: string[] = []
  private open: Task[] | null = null
  private queued = false
  private writing: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    this.logFile = path.join(dir, "log.jsonl")
    this.openFile = path.join(dir, "open.json")
  }

  // The tasks that hadn't finished when owlit last stopped. open.json first; when it is missing or
  // unreadable, the last line of each task in the log.
  async load(): Promise<Task[]> {
    const stored = await readJson<OpenFile>(this.openFile).catch(() => undefined)
    if (stored) return stored.tasks
    let log: string
    try {
      log = await readFile(this.logFile, "utf8")
    } catch {
      return []
    }
    const last = new Map<string, Task>()
    for (const line of log.split("\n")) {
      try {
        const { task } = JSON.parse(line) as { task: Task }
        if (task?.id) last.set(task.id, task)
      } catch {
        // A line cut short by a crash
      }
    }
    return [...last.values()].filter((task) => !isTaskFinished(task))
  }

  // A task's new state, and the unfinished tasks as they stand now. open is left as it was when
  // omitted (a change only the log needs).
  record(task: Task, open?: Task[]) {
    this.lines.push(JSON.stringify({ at: Date.now(), task }) + "\n")
    if (open) this.open = open
    if (this.queued) return
    this.queued = true
    this.writing = this.writing
      .then(() => this.drain())
      .catch((error) => console.error("[core] couldn't write the task log", error))
  }

  // Resolves once everything recorded so far is on disk
  async flush() {
    await this.writing
  }

  private async drain() {
    this.queued = false
    const lines = this.lines.splice(0)
    const open = this.open
    this.open = null
    await mkdir(path.dirname(this.logFile), { recursive: true })
    if (lines.length) await appendFile(this.logFile, lines.join(""))
    if (open) await writeJsonAtomic(this.openFile, { version: 1, tasks: open } satisfies OpenFile)
  }
}
