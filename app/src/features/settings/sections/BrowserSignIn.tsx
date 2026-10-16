import { t } from "@lingui/core/macro"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useChatStore } from "@/features/chat/store"
import type { Connector } from "@/features/chat/types"
import { toastError } from "@/lib/toast"

// Sign in… for Claude Code and Codex: owlit runs the agent's own sign-in, which opens the browser and
// comes back once the person is in, so nobody needs Terminal or the agent's own command. Drawn as the
// place around it draws its actions (a text button on the welcome page, outline in Settings).
export function BrowserSignIn({ c, variant = "outline", className }: { c: Connector; variant?: "outline" | "text"; className?: string }) {
  const signIn = useChatStore((s) => s.signInConnector)
  const [waiting, setWaiting] = useState(false)
  if (!c.browserSignIn) return null
  const methodId = c.browserSignIn
  const start = async () => {
    setWaiting(true)
    try {
      await signIn(c.id, methodId)
    } catch (error) {
      toastError(error, t`The sign-in didn't finish.`)
    } finally {
      setWaiting(false)
    }
  }
  return waiting ? (
    <span className="inline-flex items-center gap-1.5 text-detail text-muted-foreground">
      <Spinner className="size-3" />
      {t`Finish signing in in your browser…`}
    </span>
  ) : (
    <Button variant={variant} size={variant === "text" ? "inline" : "sm"} className={className} onClick={() => void start()}>
      {t({ message: "Sign in…", comment: "an agent's sign-in, which opens the browser" })}
    </Button>
  )
}
