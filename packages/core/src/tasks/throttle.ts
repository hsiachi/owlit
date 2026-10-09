import type { Task } from "@owlit/protocol"

// Passes each task's changes on at most every ms: the first at once, then the latest one at the end
// of each window. A task's last state always gets through.
export class TaskThrottle {
  private readonly ms: number
  private readonly send: (task: Task) => void
  private windows = new Map<string, { timer: ReturnType<typeof setTimeout>; latest?: Task }>()

  constructor(ms: number, send: (task: Task) => void) {
    this.ms = ms
    this.send = send
  }

  push(task: Task) {
    const window = this.windows.get(task.id)
    if (window) {
      window.latest = task
      return
    }
    this.send(task)
    this.open(task.id)
  }

  // Sends what is pending now (closing a workspace)
  flush() {
    for (const [id, window] of this.windows) {
      clearTimeout(window.timer)
      if (window.latest) this.send(window.latest)
      this.windows.delete(id)
    }
  }

  private open(id: string) {
    const timer = setTimeout(() => {
      const latest = this.windows.get(id)?.latest
      this.windows.delete(id)
      if (!latest) return
      this.send(latest)
      this.open(id)
    }, this.ms)
    this.windows.set(id, { timer })
  }
}
