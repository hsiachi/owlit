// A store that reads its list from core, then follows core's notifications about it. A notification heard
// while the list is being read is newer than the list: it is held until the list is in the store and then
// applied on top, so the older list doesn't wipe it.

export function followCore<T>({ read, take }: {
  // The list; undefined when there is nothing to take (the workspace changed while it was read)
  read: () => Promise<T | undefined>
  take: (list: T) => void
}) {
  let loads = 0
  let held: (() => void)[] | null = null

  return {
    // Reads and takes the list. A load started meanwhile supersedes this one: its list is dropped, and what
    // was held waits for the newer load. A failed read still applies what was held, and rejects.
    async load() {
      const mine = ++loads
      held = []
      try {
        const list = await read()
        if (mine === loads && list !== undefined) take(list)
      } finally {
        if (mine === loads) {
          const changes = held
          held = null
          for (const change of changes) change()
        }
      }
    },
    // A change core reported: applied at once, or after the list being read is taken
    hear(change: () => void) {
      if (held) held.push(change)
      else change()
    },
  }
}
