import { plural, t } from "@lingui/core/macro"
import { useState } from "react"
import { OwlitLockup } from "@/components/owlit-lockup"
import { Button } from "@/components/ui/button"
import { ext } from "../lib/browser.ts"
import { originsOf, send } from "../lib/messages.ts"
import { askForOrigins, type Asked } from "../lib/permissions.ts"

// The page the extension opens when the user pressed Allow… on a waiting line in owlit's window: the
// browser asks for a site's permission only from a click inside the extension, so the click is here
export function Allow({ host, papers }: { host: string; papers: number }) {
  const [asked, setAsked] = useState<Asked | null>(null)

  // Nothing awaited before the request: Firefox refuses one that isn't straight from the click
  const allow = async () => {
    const answer = await askForOrigins(ext.permissions, originsOf(host))
    setAsked(answer)
    if (answer === "granted") await send({ kind: "allowed", host })
  }

  let said: string | undefined
  if (asked === "granted") said = t`owlit goes on at ${host}. You can close this tab.`
  else if (asked === "refused") said = t`owlit can't get these PDFs with your access until you allow it.`
  else if (asked === "unasked") said = t`Your browser didn't ask. Allow ${host} for owlit in the browser's extension settings.`

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 px-4 text-sm">
      <OwlitLockup className="h-5 w-auto self-start text-foreground" />
      <h1 className="text-base font-medium text-balance">{t`Let the owlit extension read ${host}`}</h1>
      <p className="text-muted-foreground">
        {plural(papers, {
          one: `# paper in your Library waits for its PDF there. The extension fetches it with your access, and reads only what owlit asks for.`,
          other: `# papers in your Library wait for their PDFs there. The extension fetches them with your access, and reads only what owlit asks for.`,
        })}
      </p>
      {said && (
        <p role="status" className="text-detail text-muted-foreground">
          {said}
        </p>
      )}
      {asked !== "granted" && (
        <Button className="self-start" onClick={() => void allow()} disabled={!host}>
          {t({ message: "Allow", comment: "button: let the owlit extension read this site, for the papers waiting there" })}
        </Button>
      )}
    </main>
  )
}
