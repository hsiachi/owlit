import { onNotify, rpc } from "@/lib/rpc"
import type { QuestionAnswer } from "@owlit/protocol"
import type { Connector, SessionUpdate, StopReason } from "../types"
import type { AgentClient, PromptRequest } from "./client"

// The real agent client in the desktop app: turns run in core on the user's local agents (ACP). Core
// saves both messages of a turn itself; this side only shows what streams in.
export class RpcAgentClient implements AgentClient {
  readonly persistsMessages = true

  listConnectors(): Promise<Connector[]> {
    return rpc.agents.list()
  }

  check(connector: Connector): Promise<Connector> {
    return rpc.agents.check({ id: connector.id })
  }

  async prompt(req: PromptRequest, onUpdate: (update: SessionUpdate) => void, signal: AbortSignal): Promise<StopReason> {
    if (!req.userMessage || !req.assistantMessageId) throw new Error("A turn needs its messages.")
    // Only this turn's reply: the chat's previous one may still be getting what its agent sent after its
    // turn (store.ts, lateReply)
    const stopListening = onNotify("chat.update", ({ chatId, messageId, update }) => {
      if (chatId === req.chatId && messageId === req.assistantMessageId) onUpdate(update)
    })
    const cancel = () => void rpc.agents.cancel({ chatId: req.chatId }).catch(() => undefined)
    signal.addEventListener("abort", cancel)
    try {
      const { stopReason } = await rpc.agents.prompt({
        chatId: req.chatId,
        connectorId: req.connectorId,
        modelId: req.modelId,
        role: req.role,
        effortId: req.effortId,
        input: { ...req.input, attachments: req.input.attachments.map(({ previewUrl: _url, ...a }) => a) },
        userMessage: req.userMessage,
        assistantMessageId: req.assistantMessageId,
      })
      return stopReason
    } finally {
      signal.removeEventListener("abort", cancel)
      stopListening()
    }
  }

  respondPermission(chatId: string, requestId: string, optionId: string) {
    void rpc.agents.respondPermission({ chatId, requestId, optionId }).catch(() => undefined)
  }

  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) {
    void rpc.agents.answerQuestion({ chatId, requestId, answers }).catch(() => undefined)
  }
}
