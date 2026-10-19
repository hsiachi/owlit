import { t } from "@lingui/core/macro"
import type { CutOff } from "@owlit/protocol"
import { messageOf } from "../util.ts"
import type { Agents } from "./agents.ts"
import { AgentEnded, endingSentence, isAuthError } from "./process.ts"

// An error that says nothing beyond that there was one: the agent's own words then explain it
const GENERIC = /^(internal error|error|unknown error)\.?$/i

// What owlit says when an agent's session fails, the same for a chat turn and a background run, with how
// the agent's process ended as its detail. said: the error the agent wrote as its last words
// (withoutAgentError), which decides between a sign-in and a refusal it can't fix by signing in.
export async function failureOf(agents: Agents, connectorId: string, error: unknown, said: string): Promise<{ text: string; detail?: string; cutOff?: CutOff }> {
  if (error instanceof AgentEnded) {
    // The agent's process went away mid-turn; the library only says its connection closed
    const name = await agents.nameOf(connectorId)
    const detail = error.ending ? { detail: endingSentence(name, error.ending) } : {}
    if (error.stopped) return { text: cutOffSentence("closed"), cutOff: "closed", ...detail }
    return { text: t`${name} quit unexpectedly. It starts again with the next message.`, ...detail }
  }
  if (isAuthError(error)) return { text: /\b403\b/.test(said) ? await agents.refused(connectorId) : await agents.signedOut(connectorId) }
  if (GENERIC.test(messageOf(error)) && said) return { text: await agents.nameOf(connectorId).then((name) => t`${name} ran into a problem.`) }
  return { text: messageOf(error) }
}

// What a reply cut off that way says, in place of "stopped"
export function cutOffSentence(why: CutOff) {
  return why === "switched" ? t`Owlit was closed before it finished, when you opened another workspace.` : t`Owlit was closed before it finished.`
}
