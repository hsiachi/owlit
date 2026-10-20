import { t } from "@lingui/core/macro"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@owlit/protocol"
import { toastError } from "@/lib/toast"

// Sign in… for Claude Code and Codex: owlit runs the agent's own sign-in, which opens the browser and
// comes back once the person is in, so nobody needs Terminal or the agent's own command. Drawn as the
// place around it draws its actions (a text button on the welcome page, outline in Settings). Whether one
// waits is core's (the agent's signingIn), so every place that shows the agent says the same, and leaving
// a step and coming back still shows the wait, with the page to open again and Cancel. A sign-in opened
// again or cancelled ends without an error, so only one that failed says so.
export function BrowserSignIn({ c, variant = "outline", className }: { c: Connector; variant?: "outline" | "text"; className?: string }) {
  const signIn = useChatStore((s) => s.signInConnector)
  const cancel = useChatStore((s) => s.cancelSignIn)
  if (!c.browserSignIn) return null
  const methodId = c.browserSignIn
  const start = () => signIn(c.id, methodId).catch((error: unknown) => toastError(error, t`The sign-in didn't finish.`))
  return c.signingIn ? (
    <span className="inline-flex items-center gap-1.5 text-detail text-muted-foreground">
      <Spinner className="size-3" />
      {t`Finish signing in in your browser…`}
      <Button variant="text" size="inline" onClick={() => void start()}>
        {t({ message: "Open the page again", comment: "the agent's sign-in page in the browser" })}
      </Button>
      <Button variant="text" size="inline" onClick={() => void cancel(c.id).catch(toastError)}>
        {t`Cancel`}
      </Button>
    </span>
  ) : (
    <Button variant={variant} size={variant === "text" ? "inline" : "sm"} className={className} onClick={() => void start()}>
      {t({ message: "Sign in…", comment: "an agent's sign-in, which opens the browser" })}
    </Button>
  )
}
