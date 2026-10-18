import { vi } from "vitest"

// Waiting in tests: poll a condition instead of sleeping a fixed time, and always fail when it never holds.
// Only test files import this.

// Well below the 15 s test timeout core's vitest.config.ts sets, so a wait that never ends fails with its own
// message instead of "test timed out"; change the two together.
export const WAIT = { timeout: 5_000, interval: 20 }

// Resolves with check's first truthy value; retries while it returns something falsy or throws, and throws
// once the timeout passes (with check's last error when it threw).
export async function until<T>(check: () => T | Promise<T>, options: { timeout?: number; what?: string } = {}): Promise<NonNullable<T>> {
  const { timeout = WAIT.timeout, what = "the condition" } = options
  return vi.waitFor(
    async () => {
      const value = await check()
      if (!value) throw new Error(`gave up waiting for ${what} after ${timeout} ms`)
      return value as NonNullable<T>
    },
    { timeout, interval: WAIT.interval },
  )
}

// vi.waitFor for expect-style checks, with the shared patience
export const eventually = <T>(check: () => T | Promise<T>, timeout = WAIT.timeout) => vi.waitFor(check, { timeout, interval: WAIT.interval })

// Core's searchPath for tests that start agents: this process's PATH, so the developer's login shell
// (~/.zshrc, up to 10 s) doesn't run inside a test
export const testSearchPath = async () => process.env.PATH ?? ""
