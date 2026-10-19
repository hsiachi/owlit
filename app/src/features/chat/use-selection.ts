import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "./store"
import { DEFAULT_ROLE, type Role } from "@owlit/protocol"
import { resolveSelection, roleOf, selectionOf, type Selection } from "./lib/selection"

// The agent, model, effort and role in effect for a chat (or for a new chat), and a way to change them.
// The role is the chat's own; for a chat not started yet it is the one the composer holds for it.
export function useResolvedSelection(chatId?: string) {
  const connectors = useChatStore((s) => s.connectors)
  const globalSelection = useChatStore((s) => s.selection)
  const newChatRole = useChatStore((s) => s.newChatRole)
  // Only the chat's choice, so a streamed reply doesn't redraw the composer
  const chat = useChatStore(
    useShallow((s) => {
      const c = chatId ? s.chats[chatId] : undefined
      return c ? { connectorId: c.connectorId, modelId: c.modelId, role: c.role, effortId: c.effortId } : undefined
    }),
  )
  const setSelection = useChatStore((s) => s.setSelection)
  const setChatSelection = useChatStore((s) => s.setChatSelection)
  const setChatRole = useChatStore((s) => s.setChatRole)

  const update = (patch: Partial<Selection> & { role?: Role }) => {
    const { role, ...rest } = patch
    if (role) setChatRole(chatId, role)
    if (Object.keys(rest).length) (chatId ? setChatSelection(chatId, rest) : setSelection(rest))
  }
  return { connectors, ...resolveSelection(connectors, selectionOf(chat, globalSelection)), role: roleOf(chat, chatId ? DEFAULT_ROLE : newChatRole), update }
}
