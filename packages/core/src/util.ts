import { isDeepStrictEqual } from "node:util"

// Runs work one at a time, in the order it was given. A failure is the caller's to handle and doesn't
// stop what comes after it; onError also hears it (for a chain nobody awaits).
export class Serial {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly onError?: (error: unknown) => void

  constructor(onError?: (error: unknown) => void) {
    this.onError = onError
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work)
    this.tail = run.catch((error) => this.onError?.(error))
    return run
  }

  // Settles once everything queued so far has
  get idle(): Promise<unknown> {
    return this.tail
  }
}

// The same object without the fields that are undefined, so a JSON file doesn't keep them as keys
export function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

// Two values as JSON keeps them (as the change log does), whatever the order of their keys
export const sameJson = (a: unknown, b: unknown) => isDeepStrictEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b === undefined ? b : JSON.parse(JSON.stringify(b)))

// What went wrong, as words. An ACP error arrives as a plain object with a message, not an Error.
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error)
