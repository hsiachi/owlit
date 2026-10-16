import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { answerPairing, useExtension } from "./store"

// An extension in the user's browser asks to connect: the oldest question, answered here. Esc is Don't
// allow; the extension can ask again from its button.
export function PairDialog() {
  // Mounted outside the routed page, which a language change remounts: it listens itself
  useLingui()
  const asking = useExtension((s) => s.view?.asking[0])
  return (
    // Each way out answers once: the buttons and Esc; the dialog closes when the question leaves the store
    <AlertDialog open={!!asking}>
      {asking && (
        <AlertDialogContent onEscapeKeyDown={() => void answerPairing(asking.id, false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`An extension in ${asking.browser} wants to connect to owlit.`}</AlertDialogTitle>
            {/* For screen readers; the title says what is asked */}
            <AlertDialogDescription className="sr-only">{t`It can add the papers you open in ${asking.browser} to your Library and give owlit their PDFs.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void answerPairing(asking.id, false)}>{t`Don't allow`}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void answerPairing(asking.id, true)}>{t`Allow`}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
