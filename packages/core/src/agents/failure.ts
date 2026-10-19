import { t } from "@lingui/core/macro"
import type { CutOff } from "@owlit/protocol"
import { messageOf } from "../util.ts"
import type { Agents } from "./agents.ts"
import { AgentEnded, endingSentence, isAuthError } from "./process.ts"

// An error that says nothing beyond that there was one: the agent's own words then explain it
const GENERIC = /^(internal error|error|unknown error)\.?$/i

// An agent's account running out: Claude Code's "You've hit your session limit · resets 2:20am
// (Asia/Shanghai)" and the other openings its SDK lists (USAGE_LIMIT_ERROR_PREFIXES), Codex's "You've hit
// your usage limit. … Try again at 8:15 PM."
const LIMIT = /You['’]ve (?:hit|reached) your\b[^\n]*?\b(?:limit|usage)|You['’]re out of (?:usage credits|extra usage)|\bis out of usage\b/i
// When it resets, as the message says it: "resets 2:20am", "resets Oct 21, 5pm", "try again at 8:15 PM"
const RESETS = /\b(?:resets|try again at)\s+([^()\n]*?\d[^()\n]*?)\s*(?:\(|\.(?:\s|$)|$)/i
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/i

// What owlit says when an agent's turn fails, with how the agent's process ended as its detail. said: the
// error the agent wrote as its last words (withoutAgentError), which decides between a sign-in and a
// refusal it can't fix by signing in.
export async function failureOf(agents: Agents, connectorId: string, error: unknown, said: string): Promise<{ text: string; detail?: string; cutOff?: CutOff }> {
  if (error instanceof AgentEnded) {
    // The agent's process went away mid-turn; the library only says its connection closed
    const name = await agents.nameOf(connectorId)
    const detail = error.ending ? { detail: endingSentence(name, error.ending) } : {}
    if (error.stopped) return { text: cutOffSentence("closed"), cutOff: "closed", ...detail }
    return { text: t`${name} quit unexpectedly. It starts again with the next message.`, ...detail }
  }
  const limit = [messageOf(error), said].map((m) => m.replace(/^Internal error:\s*/i, "").trim()).find((m) => LIMIT.test(m))
  if (limit) return { text: limitSentence(await agents.nameOf(connectorId), limit), detail: limit }
  if (isAuthError(error)) return { text: /\b403\b/.test(said) ? await agents.refused(connectorId) : await agents.signedOut(connectorId) }
  if (GENERIC.test(messageOf(error)) && said) return { text: await agents.nameOf(connectorId).then((name) => t`${name} ran into a problem.`) }
  return { text: messageOf(error) }
}

// What a reply cut off that way says, in place of "stopped"
export function cutOffSentence(why: CutOff) {
  return why === "switched" ? t`Owlit was closed before it finished, when you opened another workspace.` : t`Owlit was closed before it finished.`
}

// "Claude Code's usage limit is reached; it resets at 2:20." from the agent's own words: the time on a
// 24-hour clock, since the sentence is said in every language the interface has and "2:20am" isn't
function limitSentence(name: string, message: string) {
  const resets = RESETS.exec(message)?.[1]
  if (!resets) return t`${name}'s usage limit is reached.`
  const clock = CLOCK.exec(resets)
  const at = clock
    ? `${resets.slice(0, clock.index).replace(/[\s,]+$/, "")} ${(Number(clock[1]) % 12) + (clock[3].toLowerCase() === "p" ? 12 : 0)}:${clock[2] ?? "00"}`.trim()
    : resets
  return t`${name}'s usage limit is reached; it resets at ${at}.`
}
