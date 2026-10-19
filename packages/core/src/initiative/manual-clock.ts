import type { Clock } from "./initiative.ts"

// For tests: a clock that moves only when told
export class ManualClock implements Clock {
  at = Date.parse("2026-10-16T09:00:00Z")
  now() {
    return this.at
  }
  advance(ms: number) {
    this.at += ms
  }
}
