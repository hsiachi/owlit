import { isTaskFinished, type Task } from "@owlit/protocol"
import { appendFile, mkdir, rename, stat } from "node:fs/promises"
import path from "node:path"
import { readJson, readJsonl, writeJsonAtomic } from "../fs-util.ts"

interface OpenFile {
  version: 1
  tasks: Task[]
}

// How large log.jsonl grows before it becomes log.1.jsonl and a new one starts. Every change of every
// task is a line, progress included, so a big import writes megabytes; two files of this size are kept.
const LOG_MAX_BYTES = 10 * 1024 * 1024

// <workspace data dir>/tasks/: log.jsonl gets one line per change of state (the history, for looking
// back and for recovery), and the file before it is log.1.jsonl; open.json holds the unfinished tasks
// whole and is what a restart reads. Writes happen in order, batched while one is in flight.
export class TaskStore {
  private readonly logFile: string
  private readonly olderFile: string
  private readonly openFile: string
  private readonly maxLogBytes: number
  // log.jsonl's size, read from disk at the first write
  private logBytes: number | null = null
  private lines: string[] = []
  private open: Task[] | null = null
  private queued = false
  private writing: Promise<void> = Promise.resolve()

  constructor(dir: string, options: { maxLogBytes?: number } = {}) {
    this.logFile = path.join(dir, "log.jsonl")
    this.olderFile = path.join(dir, "log.1.jsonl")
    this.openFile = path.join(dir, "open.json")
    this.maxLogBytes = options.maxLogBytes ?? LOG_MAX_BYTES
  }

  // The tasks that hadn't finished when owlit last stopped. open.json first; when it is missing or
  // unreadable, the last line of each task in the log, the older file first.
  async load(): Promise<Task[]> {
    const stored = await readJson<OpenFile>(this.openFile).catch(() => undefined)
    if (stored) return stored.tasks
    const last = new Map<string, Task>()
    const lines = [...(await readJsonl<{ task?: Task } | null>(this.olderFile)), ...(await readJsonl<{ task?: Task } | null>(this.logFile))]
    for (const line of lines) if (line?.task?.id) last.set(line.task.id, line.task)
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
    if (lines.length) {
      const text = lines.join("")
      this.logBytes ??= await stat(this.logFile).then((s) => s.size, () => 0)
      if (this.logBytes > 0 && this.logBytes + Buffer.byteLength(text) > this.maxLogBytes) {
        await rename(this.logFile, this.olderFile)
        this.logBytes = 0
      }
      await appendFile(this.logFile, text)
      this.logBytes += Buffer.byteLength(text)
    }
    if (open) await writeJsonAtomic(this.openFile, { version: 1, tasks: open } satisfies OpenFile)
  }
}
