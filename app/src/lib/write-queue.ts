// How a store's changes reach core: queued and sent one at a time, in the order they were made, so the
// UI never waits for the disk. Opening another workspace drops what was queued for the old one.

export function createWorkspaceQueue({ onError }: { onError: (error: unknown) => unknown }) {
  let chain: Promise<void> = Promise.resolve()
  let generation = 0

  return {
    // Runs op after everything queued before it, unless another workspace opened in between. A failure
    // goes to onError; `after` runs either way, told whether the workspace is still the same.
    enqueue(op: () => Promise<unknown>, after?: (sameWorkspace: boolean) => void) {
      const gen = generation
      chain = chain.then(async () => {
        try {
          if (gen === generation) await op()
        } catch (error) {
          if (gen === generation) await onError(error)
        } finally {
          after?.(gen === generation)
        }
      })
    },
    // Called when a workspace opens: what is still queued is dropped
    reset() {
      generation++
    },
    // Resolves once every op queued so far is done
    settled: () => chain,
    // For work that awaits outside the queue: whether the workspace open now is still open
    tracker() {
      const gen = generation
      return () => gen === generation
    },
  }
}

// Up while a store takes what came from disk or core, so its watchers don't mistake it for the user's
// change and send it back
export function createDiskFlag() {
  let on = false
  return {
    apply(update: () => void) {
      on = true
      try {
        update()
      } finally {
        on = false
      }
    },
    isOn: () => on,
  }
}
