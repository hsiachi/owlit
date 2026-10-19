import { onNotify, rpc } from "@/lib/rpc"
import type { ChatMessage, Connector, QuestionAnswer, SessionUpdate, StopReason } from "@owlit/protocol"
import type { AgentClient, PromptRequest, RunningTurn } from "./client"

// The real agent client in the desktop app: turns run in core on the user's local agents (ACP). Core
// saves both messages of a turn itself and tells every window of each turn's updates and end.
export class RpcAgentClient implements AgentClient {
  check(connector: Connector): Promise<Connector> {
    return rpc.agents.check({ id: connector.id })
  }

  async prompt(req: PromptRequest): Promise<StopReason> {
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
  }

  cancel(chatId: string) {
    void rpc.agents.cancel({ chatId }).catch(() => undefined)
  }

  running(): Promise<RunningTurn[]> {
    return rpc.agents.running()
  }

  onUpdate(listener: (chatId: string, messageId: string, update: SessionUpdate) => void) {
    return onNotify("chat.update", ({ chatId, messageId, update }) => listener(chatId, messageId, update))
  }

  onEnded(listener: (chatId: string, messageId: string, message: ChatMessage) => void) {
    return onNotify("chat.ended", ({ chatId, messageId, message }) => listener(chatId, messageId, message))
  }

  respondPermission(chatId: string, requestId: string, optionId: string) {
    void rpc.agents.respondPermission({ chatId, requestId, optionId }).catch(() => undefined)
  }

  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) {
    void rpc.agents.answerQuestion({ chatId, requestId, answers }).catch(() => undefined)
  }
}
