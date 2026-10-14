import { t } from "@lingui/core/macro"
import type { StateCreator, StoreApi } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { agentClient } from "./agent"
import { builtInConnectors } from "./mocks/connectors"
import { resolveSelection } from "./lib/selection"
import type { ChatState } from "./store"
import type { Connector } from "./types"

// The local agents chats run on. In the desktop app core says which exist (listed once, then kept current);
// until it answers there are none. In a plain browser they are the built-in mocks and the user's own.
export interface ConnectorSlice {
  connectors: Connector[]
  checkConnector: (id: string) => Promise<void>
  // The agent's own sign-in (the Owlit engine); throws what went wrong, for the form to show
  signInConnector: (id: string, methodId: string, apiKey?: string) => Promise<void>
  signOutConnector: (id: string, methodId?: string) => Promise<void>
  addCustomConnector: (name: string, command: string) => Promise<Connector>
  removeConnector: (id: string) => void
  // owlit's own copy of the agent's adapter (Claude Code, Codex): set up or updated, or the setup stopped.
  // Progress and the end come as agents.changed.
  setUpConnector: (id: string) => Promise<void>
  cancelSetUp: (id: string) => Promise<void>
}

// The list with one agent as it is now
export const withConnector = (connectors: Connector[], next: Connector) => connectors.map((c) => (c.id === next.id ? next : c))

export const connectorSlice: StateCreator<ChatState, [["zustand/persist", unknown]], [], ConnectorSlice> = (set, get) => ({
  connectors: isDesktop ? [] : builtInConnectors,

  async checkConnector(id) {
    const c = get().connectors.find((x) => x.id === id)
    if (!c) return
    set((s) => ({ connectors: withConnector(s.connectors, { ...c, status: "checking", error: undefined }) }))
    const result = await agentClient.check(c).catch((e: Error) => ({ ...c, status: "error" as const, error: e.message }))
    set((s) => ({ connectors: withConnector(s.connectors, result) }))
  },

  async signInConnector(id, methodId, apiKey) {
    const result = await rpc.agents.signIn({ id, methodId, ...(apiKey ? { apiKey } : {}) })
    set((s) => ({ connectors: withConnector(s.connectors, result) }))
  },

  async setUpConnector(id) {
    const result = await rpc.agents.setUp({ id })
    set((s) => ({ connectors: withConnector(s.connectors, result) }))
  },

  async cancelSetUp(id) {
    const result = await rpc.agents.cancelSetUp({ id })
    set((s) => ({ connectors: withConnector(s.connectors, result) }))
  },

  async signOutConnector(id, methodId) {
    const result = await rpc.agents.signOut({ id, ...(methodId ? { methodId } : {}) })
    set((s) => ({ connectors: withConnector(s.connectors, result) }))
  },

  async addCustomConnector(name, command) {
    if (isDesktop) {
      const c = await rpc.agents.add({ name, command })
      set((s) => ({ connectors: [...s.connectors, c] }))
      return c
    }
    const c: Connector = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim() || t`Custom agent`,
      description: t`Custom ACP agent`,
      command: command.trim(),
      builtIn: false,
      status: "unknown",
      models: [{ id: "default", name: t({ message: "Default", comment: "the model or mode an agent uses when none is picked" }) }],
      modes: [{ id: "default", name: t({ message: "Default", comment: "the model or mode an agent uses when none is picked" }) }],
      defaultModelId: "default",
      defaultModeId: "default",
    }
    set((s) => ({ connectors: [...s.connectors, c] }))
    return c
  },

  removeConnector(id) {
    if (isDesktop) void rpc.agents.remove({ id }).catch(() => undefined)
    set((s) => {
      const connectors = s.connectors.filter((c) => c.id !== id)
      const selection =
        s.selection.connectorId === id
          ? { connectorId: connectors[0]?.id ?? "", modelId: connectors[0]?.defaultModelId, role: s.selection.role }
          : s.selection
      return { connectors, selection }
    })
  },
})

// The pickers show what the agent offers; a remembered model or effort it doesn't offer falls back to the
// agent's own default
function fitSelection(store: StoreApi<ChatState>) {
  const { connectors, selection } = store.getState()
  const { connector, model, effort, role } = resolveSelection(connectors, selection)
  if (connector) store.setState({ selection: { connectorId: connector.id, modelId: model?.id, role: role.id, effortId: effort?.id } })
}

// Agents never checked are checked now, so the user never sees an "unknown" state
function checkUnchecked(store: StoreApi<ChatState>) {
  const { connectors, checkConnector } = store.getState()
  for (const c of connectors) if (c.status === "unknown") void checkConnector(c.id)
}

export function watchConnectors(store: StoreApi<ChatState>) {
  if (!isDesktop) return checkUnchecked(store)
  // Agents are this machine's, not the workspace's: listed once, then kept current by core
  void rpc.agents.list().then((connectors) => {
    store.setState({ connectors })
    fitSelection(store)
    checkUnchecked(store)
  })
  onNotify("agents.changed", (connector) => {
    store.setState((s) => ({ connectors: withConnector(s.connectors, connector) }))
    fitSelection(store)
  })
}
