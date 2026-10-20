import { hasCore } from "@/lib/rpc"
import type { AgentClient } from "./client"
import { MockAgentClient } from "./mock-client"
import { RpcAgentClient } from "./rpc-client"

// The local agents' client: core's in the desktop app, the mock in a plain browser
export const agentClient: AgentClient = hasCore ? new RpcAgentClient() : new MockAgentClient()
