import { useChatStore } from "../store"

// Apply and Discard on an edit an agent proposed (in a doc or a paper's note) answer its permission request:
// allow or reject once, or the nearest the agent offers
export function respondToEdit(chatId: string, requestId: string, apply: boolean) {
  const chat = useChatStore.getState().chats[chatId]
  const part = chat?.messages.at(-1)?.parts.find((p) => p.type === "permission" && p.requestId === requestId)
  if (part?.type !== "permission") return
  const option = part.options.find((o) => o.kind === (apply ? "allow_once" : "reject_once")) ?? part.options.find((o) => o.kind.startsWith(apply ? "allow" : "reject"))
  if (option) useChatStore.getState().respondPermission(chatId, requestId, option.optionId)
}
