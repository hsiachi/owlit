import type { ActivityEvent, ActivityKind, ActivityOf } from "@owlit/protocol"

type Listener<E extends ActivityEvent = ActivityEvent> = (event: E) => void

// In-memory fan-out of activity events. Nothing is kept: a listener hears what happens after it
// subscribes. The journal is one listener; core's turning a paper Read once read in full is another.
export class ActivityBus {
  private byKind = new Map<ActivityKind, Set<Listener>>()
  private all = new Set<Listener>()

  publish(event: ActivityEvent) {
    for (const listener of [...(this.byKind.get(event.kind) ?? []), ...this.all]) {
      try {
        listener(event)
      } catch (error) {
        console.error(`[core] an activity listener for ${event.kind} threw`, error)
      }
    }
  }

  // Hear every event, or only the kinds given; returns an unsubscribe
  subscribe(listener: Listener): () => void
  subscribe<K extends ActivityKind>(kinds: K | readonly K[], listener: Listener<ActivityOf<K>>): () => void
  subscribe(kindsOrListener: ActivityKind | readonly ActivityKind[] | Listener, maybeListener?: Listener) {
    if (typeof kindsOrListener === "function") {
      this.all.add(kindsOrListener)
      return () => {
        this.all.delete(kindsOrListener)
      }
    }
    const listener = maybeListener!
    const kinds = typeof kindsOrListener === "string" ? [kindsOrListener] : kindsOrListener
    for (const kind of kinds) {
      const set = this.byKind.get(kind) ?? new Set()
      set.add(listener)
      this.byKind.set(kind, set)
    }
    return () => {
      for (const kind of kinds) this.byKind.get(kind)?.delete(listener)
    }
  }
}
