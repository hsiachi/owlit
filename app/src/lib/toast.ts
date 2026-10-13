import { t } from "@lingui/core/macro"
import { toast } from "sonner"

// Says something was just done, with Undo to take it back
export const toastUndo = (message: string, undo: () => unknown, opts?: { description?: string }) =>
  toast(message, { ...opts, action: { label: t({ message: "Undo", comment: "verb: take back what was just done" }), onClick: () => void undo() } })
