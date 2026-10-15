import { t } from "@lingui/core/macro"
import { toast } from "sonner"

// Says something was just done, with Undo to take it back
export const toastUndo = (message: string, undo: () => unknown, opts?: { description?: string }) =>
  toast(message, { ...opts, action: { label: t({ message: "Undo", comment: "verb: take back what was just done" }), onClick: () => void undo() } })

// Says what went wrong: an Error's own message, else the fallback, else whatever was thrown. Returns
// nothing, so `.catch(toastError)` leaves the promise's value undefined on failure.
export function toastError(error: unknown, fallback?: string): void {
  toast.error((error instanceof Error && error.message) || fallback || String(error))
}
