import { describe, expect, it, vi } from "vitest"
import { createWorkspaceQueue } from "./write-queue"

describe("createWorkspaceQueue", () => {
  it("drops what was queued for a workspace once another opens", async () => {
    const queue = createWorkspaceQueue({ onError: () => undefined })
    let release: (() => void) | undefined
    const ran: string[] = []
    const after = vi.fn()
    queue.enqueue(() => new Promise<void>((r) => (release = r)).then(() => void ran.push("running")))
    queue.enqueue(async () => void ran.push("queued"), after)

    // The first is under way when the workspace changes; the second hasn't started
    await vi.waitFor(() => expect(release).toBeDefined())
    queue.reset()
    queue.enqueue(async () => void ran.push("next workspace"))
    release!()
    await queue.settled()

    expect(ran).toEqual(["running", "next workspace"])
    expect(after).toHaveBeenCalledWith(false)
  })
})
