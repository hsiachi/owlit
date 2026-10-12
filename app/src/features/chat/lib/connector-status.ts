import type { Connector, ConnectorStatus } from "../types"

// Where an agent stands, in the words and rules every place that shows one uses

export const statusLabel: Record<ConnectorStatus, string> = {
  unknown: "Not checked",
  checking: "Checking…",
  not_installed: "Not installed",
  available: "Ready",
  connected: "Connected",
  error: "Error",
}

// Checked and there: owlit can start it, though it may still want a sign-in
export const isFound = (c: Connector) => c.status === "available" || c.status === "connected"

// Found and not known to be signed out: it can run Owlit now
export const canRun = (c: Connector) => isFound(c) && c.authenticated !== false

// Not installed or broken: picking it leads nowhere until it's fixed
export const isUnavailable = (c?: Connector) => !!c && (c.status === "not_installed" || c.status === "error")

// An agent that signs in inside owlit (the Owlit engine) and isn't signed in yet: it needs the user, but
// isn't broken
export const needsSignIn = (c: Connector) => !!c.signInMethods?.length && c.authenticated === false

// Broken in a way only the user can fix outside owlit
export const isBroken = (c: Connector) => c.status === "error" && !needsSignIn(c)

// What keeps an agent from running, if anything
export function connectorProblem(c: Connector): "not_installed" | "signed_out" | "error" | undefined {
  if (c.status === "not_installed") return "not_installed"
  if (c.status !== "error") return undefined
  return c.authenticated === false ? "signed_out" : "error"
}

const PROBLEMS = { not_installed: "isn’t installed", signed_out: "isn’t signed in", error: "can’t run" }

// "Claude Code isn’t installed", "… isn’t signed in", "… can’t run"; undefined when it can run
export function problemSentence(c: Connector) {
  const problem = connectorProblem(c)
  return problem && `${c.name} ${PROBLEMS[problem]}`
}
