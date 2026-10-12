import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "./store"
import { resolveSelection, selectionOf, type Selection } from "./lib/selection"

// The agent, model, effort and role in effect for a chat (or for a new chat), and a way to change them
export function useResolvedSelection(chatId?: string) {
  const connectors = useChatStore((s) => s.connectors)
  const globalSelection = useChatStore((s) => s.selection)
  // Only the chat's choice, so a streamed reply doesn't redraw the composer
  const chat = useChatStore(
    useShallow((s) => {
      const c = chatId ? s.chats[chatId] : undefined
      return c ? { connectorId: c.connectorId, modelId: c.modelId, role: c.role, effortId: c.effortId } : undefined
    }),
  )
  const setSelection = useChatStore((s) => s.setSelection)
  const setChatSelection = useChatStore((s) => s.setChatSelection)

  const update = (patch: Partial<Selection>) => (chatId ? setChatSelection(chatId, patch) : setSelection(patch))
  return { connectors, ...resolveSelection(connectors, selectionOf(chat, globalSelection)), update }
}
