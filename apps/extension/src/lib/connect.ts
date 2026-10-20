import { t } from "@lingui/core/macro"
import type { ExtensionStatus, OwlitIdentity } from "@owlit/protocol"
import type { Connection, Outcome } from "./messages.ts"
import { Elsewhere, OwlitError, Unreachable } from "./owlit.ts"

// Being connected to owlit, as the background decides it from owlit's answer to GET /status: what the
// popup and the card say, and what the background does next. Pure, so a test runs every answer.

export interface Kept {
  token?: string
  owlit?: OwlitIdentity
  // Why the last pairing ended without a token
  problem?: "refused" | "expired" | "no-window"
}

export interface Step {
  connection: Connection
  // Forget the token: owlit answered that it doesn't know it (forgotten in Settings, or never paired)
  unpair: boolean
  // The owlit that answered, kept for a token whose owlit wasn't known yet (paired by an owlit that didn't
  // say who it was)
  remember?: OwlitIdentity
  // Look for owlit again every 30 s (the reconnect alarm), or stop looking
  reconnect: boolean
  // Ask owlit for work (GET /work); only a connected extension does
  work: boolean
}

// status: owlit's answer, or what was thrown asking for it. Anything but owlit's answers is thrown on.
export function afterStatus(answer: { status: ExtensionStatus } | { error: unknown }, kept: Kept): Step {
  if ("status" in answer) {
    const remember = answer.status.owlit && !kept.owlit ? answer.status.owlit : undefined
    return { connection: { state: "connected", workspace: answer.status.workspace?.name ?? null }, unpair: false, remember, reconnect: false, work: true }
  }
  const { error } = answer
  if (error instanceof OwlitError && error.status === 401) {
    const connection: Connection = kept.problem ? { state: "unpaired", problem: kept.problem } : { state: "unpaired" }
    return { connection, unpair: !!kept.token, reconnect: false, work: false }
  }
  // Looked at again until the owlit it belongs to has the port
  if (error instanceof Elsewhere) return { connection: { state: "elsewhere", name: error.owlitName }, unpair: false, reconnect: true, work: false }
  if (error instanceof Unreachable) return { connection: { state: "offline", paired: !!kept.token }, unpair: false, reconnect: !!kept.token, work: false }
  throw error
}

// What a click's work that failed on owlit's side comes to
export function outcomeOfError(error: unknown): Outcome {
  if (error instanceof Unreachable) return { kind: "offline" }
  if (error instanceof Elsewhere) return { kind: "elsewhere", name: error.owlitName }
  if (error instanceof OwlitError) {
    if (error.reason === "no-workspace") return { kind: "no-workspace" }
    if (error.reason === "not-paired") return { kind: "unpaired" }
    if (error.reason === "not-this-paper") return { kind: "not-this-paper" }
    if (error.reason === "not-a-library-paper") return { kind: "unknown-pdf" }
    return { kind: "failed", message: error.message }
  }
  return { kind: "failed", message: t`Something went wrong in the owlit extension.` }
}
