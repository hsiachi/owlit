import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AcpProcess, type SessionHandler } from "./process.ts"
import { processSetup } from "./profiles.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")

const made: AcpProcess[] = []
afterEach(() => {
  for (const p of made.splice(0)) p.stop()
})

function start(setup: ReturnType<typeof processSetup>) {
  const proc = new AcpProcess({ file: process.execPath, args: [fake], env: process.env, cwd: import.meta.dirname, idleMs: 60_000, onCrash: () => {}, ...setup })
  made.push(proc)
  return proc
}

// Collects what the agent says in a session
function listener() {
  let text = ""
  const handler = {
    update: (n: { update: { sessionUpdate: string; content?: { type: string; text?: string } } }) => {
      if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content?.type === "text") text += n.update.content.text
    },
  } as unknown as SessionHandler
  return { handler, said: () => text }
}

async function ask(proc: AcpProcess, sessionId: string, said: () => string, question: string) {
  const before = said().length
  await proc.prompt({ sessionId, prompt: [{ type: "text", text: question }] })
  return said().slice(before)
}

describe("process setup", () => {
  it("names each Codex session as it opens, so codex-acp makes up no title in a thread of its own", async () => {
    const proc = start(processSetup("codex"))
    expect((await proc.initialized())._meta?.client).toEqual({ jetbrains: { air: { version: 1, capabilities: ["sessionIndex"] } } })
    const { handler, said } = listener()
    const { sessionId } = await proc.newSession({ cwd: import.meta.dirname, mcpServers: [] }, handler)
    expect(await ask(proc, sessionId, said, "title")).toBe("Owlit")
    await proc.loadSession({ sessionId, cwd: import.meta.dirname, mcpServers: [] }, handler)
    expect(await ask(proc, sessionId, said, "title")).toBe("Owlit")
  })

  it("leaves other agents' sessions as they are, and a refused request doesn't stop the session", async () => {
    expect(processSetup("claude-code")).toEqual({})
    const plain = start({})
    expect((await plain.initialized())._meta?.client).toBeNull()
    const { handler, said } = listener()
    const { sessionId } = await plain.newSession({ cwd: import.meta.dirname, mcpServers: [] }, handler)
    expect(await ask(plain, sessionId, said, "title")).toBe("untitled")
    // An adapter without the request (an older codex-acp) answers "method not found"
    const refused = start({ opened: () => ({ method: "_session/unknown", params: {} }) })
    const second = listener()
    const opened = await refused.newSession({ cwd: import.meta.dirname, mcpServers: [] }, second.handler)
    expect(await ask(refused, opened.sessionId, second.said, "title")).toBe("untitled")
  })
})
