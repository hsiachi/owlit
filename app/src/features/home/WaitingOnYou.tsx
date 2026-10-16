import { t } from "@lingui/core/macro"
import { ChevronRightIcon, XIcon } from "lucide-react"
import { GroupLabel } from "@/components/group-label"
import { IconButton } from "@/components/icon-button"
import { revealOnHover } from "@/components/row-list"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useNavigate } from "react-router-dom"
import { useWaitingOnYou, type WaitingItem } from "@/app/waiting-on-you"
import { useExtensionWaits } from "@/features/extension/store"
import { siteWaitItem } from "@/features/extension/waits"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"

// Everything stuck on the user, in one list (app/waiting-on-you.ts works it out): a permission a chat
// waits for, papers only their browser can get, handed-off work that broke, an agent that can't run.
// Each line is the thing and its fix; it leaves once answered. The whole row is the way to the fix, as
// every row on Home is a link, and its right end says what clicking does ("Open ›"); a real button is
// kept only for a fix that does something other than going there (Retry, Get them). Shown only while
// something waits, in the rows' own look (Home's Recent), not a card. The places these come from keep
// their own marks (a chat's status ring, the rail's dots); Owlit's finished-unseen dot is the rail's alone.

// The row as a screen reader hears it: "Owlit stopped in “Draft”: Open"
function rowLabel(w: WaitingItem) {
  const { what, where } = w
  const label = w.open.label
  return where ? t`${what} ${where}: ${label}` : t`${what}: ${label}`
}

export function WaitingOnYou() {
  const waiting = useWaitingOnYou().filter((w) => w.tone !== "owlit")
  if (!waiting.length) return null
  return (
    <section aria-labelledby="waiting-label">
      <GroupLabel id="waiting-label">{t`Waiting on you`}</GroupLabel>
      <WaitingRows items={waiting} />
    </section>
  )
}

// The sites the extension in the user's browser waits at that hold up nothing the user asked for: grey,
// in a block of their own rather than under Waiting on you, each with its one thing to do. Once the
// user asks for one of their papers, the site's line moves to Waiting on you, amber.
export function SiteWaits() {
  const navigate = useNavigate()
  const waits = useExtensionWaits()
  const grey = waits.filter((w) => !waitsOnYou(w)).map((w) => siteWaitItem(w, () => navigate("/library")))
  if (!grey.length) return null
  return (
    <section aria-labelledby="site-waits-label">
      <GroupLabel id="site-waits-label">{t({ message: "PDFs through your browser", comment: "Home's group of sites where the owlit extension waits for the user" })}</GroupLabel>
      <WaitingRows items={grey} />
    </section>
  )
}

function WaitingRows({ items }: { items: WaitingItem[] }) {
  return (
      <ul className="flex flex-col gap-0.5">
        {items.map((w) => (
          <li key={w.key} className="group/row relative flex min-h-9 items-center gap-2.5 rounded-md py-1 pr-2.5 pl-2.5 hover:bg-muted has-focus-key:bg-muted">
            {/* The row's own button lies under its words, so the Retry and Dismiss buttons inside stay
                buttons of their own rather than buttons in a button */}
            <button type="button" onClick={w.open.run} title={w.detail} aria-label={rowLabel(w)} className="absolute inset-0 rounded-md outline-none" />
            <w.icon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
            <p className="pointer-events-none min-w-0 flex-1 truncate text-sm">
              {w.what}
              {w.where && <span className="text-muted-foreground"> {w.where}</span>}
            </p>
            {w.dismiss && (
              // Leaving a broken reply as it is: a quiet way out, shown where the pointer or focus is
              <IconButton label={t`Dismiss`} onClick={w.dismiss} className={cn("relative", revealOnHover)}>
                <XIcon />
              </IconButton>
            )}
            {w.action ? (
              <Button size="sm" variant="outline" onClick={w.action.run} className="relative -mr-1.5">
                {w.action.label}
              </Button>
            ) : (
              <span className="pointer-events-none flex shrink-0 items-center gap-0.5 text-detail text-muted-foreground group-hover/row:text-foreground">
                {w.open.label}
                <ChevronRightIcon className="size-3.5" />
              </span>
            )}
          </li>
        ))}
      </ul>
  )
}
