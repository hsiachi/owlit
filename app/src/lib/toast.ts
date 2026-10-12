import { toast } from "sonner"

// Says something was just done, with Undo to take it back
export const toastUndo = (message: string, undo: () => unknown, opts?: { description?: string }) =>
  toast(message, { ...opts, action: { label: "Undo", onClick: () => void undo() } })
