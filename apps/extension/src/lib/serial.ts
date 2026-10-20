// One promise chain: each task starts once the one before it ended, failed or not. What reads and writes
// the same session storage keys (a tab's PDF, the PDFs taken) goes through one, so a read never runs
// between another task's read and its write.
export function serial() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T> | T): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}
