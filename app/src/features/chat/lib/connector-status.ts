import { t } from "@lingui/core/macro"
import type { Connector, ConnectorStatus } from "../types"

// Where an agent stands, in the words and rules every place that shows one uses

export function statusLabel(status: ConnectorStatus) {
  switch (status) {
    case "unknown":
      return t({ message: "Not checked", comment: "an agent's status: not checked yet whether it is installed" })
    case "checking":
      return t({ message: "Checking…", comment: "an agent's status: checking whether it is installed" })
    case "not_installed":
      return t`Not installed`
    case "available":
      return t({ message: "Ready", comment: "an agent's status" })
    case "connected":
      return t({ message: "Connected", comment: "an agent's status" })
    case "error":
      return t({ message: "Error", comment: "an agent's status" })
  }
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

// "Claude Code isn’t installed", "… isn’t signed in", "… can’t run"; undefined when it can run
export function problemSentence(c: Connector) {
  const problem = connectorProblem(c)
  const agent = c.name
  if (problem === "not_installed") return t`${agent} isn’t installed`
  if (problem === "signed_out") return t`${agent} isn’t signed in`
  if (problem === "error") return t`${agent} can’t run`
  return undefined
}
