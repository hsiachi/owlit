import type { Clock } from "./initiative.ts"

// For tests: a clock that moves only when told
export class ManualClock implements Clock {
  at = Date.parse("2026-10-16T09:00:00Z")
  private timers: { due: number; fn: () => void; id: number }[] = []
  private next = 0
  now() {
    return this.at
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.next
    this.timers.push({ due: this.at + ms, fn, id })
    return id
  }
  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((t) => t.id !== handle)
  }
  advance(ms: number) {
    this.at += ms
    const due = this.timers.filter((t) => t.due <= this.at).sort((a, b) => a.due - b.due)
    this.timers = this.timers.filter((t) => t.due > this.at)
    for (const t of due) t.fn()
  }
}
