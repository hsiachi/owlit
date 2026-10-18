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
            {/* The browser's name is the extension's own word; its address is the browser's, so a look-alike
                extension shows an address that isn't owlit's */}
            {asking.origin ? (
              <p className="font-mono text-detail break-all text-muted-foreground">{asking.origin}</p>
            ) : (
              <p className="text-detail text-muted-foreground">{t`It didn't say which extension it is.`}</p>
            )}
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
