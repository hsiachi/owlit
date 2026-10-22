import { plural, t } from "@lingui/core/macro"
import { useEffect, useMemo } from "react"
import type { ExtensionWait, Paper } from "@owlit/protocol"
import { XIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { WaitingDot } from "@/components/marks"
import { InlineLink } from "@/components/inline-link"
import { StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useExtensionWaits } from "@/features/extension/store"
import { actOnWait, noteThrough, putAwayFollowed, useFollowedWaits, waitWords, type FollowedWait } from "@/features/extension/waits"
import { pdfWait, waitsOnYou } from "../lib/pdf-wait"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// At the top of the Library, one line per site the extension in the user's browser waits at: what it
// waits for, the papers there (which the count shows), and its one thing to do. Grey, on the ladder's
// working rung: nothing the user asked for is held up, and owlit goes on by itself once they are
// through. Amber, with the waiting dot, once they asked for one of its papers (waitsOnYou).
// A line the person acted on answers in three steps (useFollowedWaits keeps the papers it had): the page
// is open in their browser; once the site is through, the PDFs coming one by one at the queue's pace;
// when none of those papers is still being looked for, what came of it, kept until put away (as the
// import's done card is, so the count doesn't run down in front of them).
export function ExtensionWaitLines() {
  const waits = useExtensionWaits()
  const followed = useFollowedWaits((s) => s.list)
  const papers = useLibraryStore((s) => s.papers)
  const showOnly = useLibraryUi((s) => s.showOnly)
  // Each site's papers, read off the papers the extension holds there
  const bySite = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const p of Object.values(papers)) {
      const host = !p.pdf && p.pdfState?.extension?.waits ? p.pdfState.extension.host : undefined
      if (host) out.set(host, [...(out.get(host) ?? []), p.id])
    }
    return out
  }, [papers])
  useEffect(() => noteThrough(waits), [waits, followed])
  const lines = waits.map((wait) => {
    const done = followed.find((f) => f.host === wait.host && !f.through)
    const ids = bySite.get(wait.host) ?? []
    return done ? <OpenedLine key={`${wait.kind}:${wait.host}`} wait={wait} followed={done} /> : <WaitLine key={`${wait.kind}:${wait.host}`} wait={wait} ids={ids} showOnly={showOnly} />
  })
  const after = followed.filter((f) => f.through && !waits.some((w) => w.host === f.host)).map((f) => <AfterLine key={`after:${f.host}`} followed={f} papers={papers} showOnly={showOnly} />)
  if (!lines.length && !after.length) return null
  return (
    <>
      {lines}
      {after}
    </>
  )
}

function WaitLine({ wait, ids, showOnly }: { wait: ExtensionWait; ids: string[]; showOnly: (ids: string[], label: string) => void }) {
  const words = waitWords(wait)
  return (
    <StatusLine
      mark={waitsOnYou(wait) ? <WaitingDot /> : null}
      actions={
        <Button variant="text" size="inline" onClick={() => void actOnWait(wait)}>
          {words.action}
        </Button>
      }
    >
      <span className="truncate">
        {words.what}
        {" · "}
        {ids.length ? <InlineLink onClick={() => showOnly(ids, words.what)}>{words.papers}</InlineLink> : words.papers}
      </span>
    </StatusLine>
  )
}

// Clicked, and the site still waits: the page is open in the person's browser, where owlit can't follow
function OpenedLine({ wait, followed }: { wait: ExtensionWait; followed: FollowedWait }) {
  const browser = followed.browser ?? t({ message: "your browser", comment: "in: Opened in your browser" })
  const step =
    wait.kind === "sign-in"
      ? t({ message: `Opened in ${browser}. Sign in there; owlit goes on by itself.`, comment: "browser: Chrome, Arc, or 'your browser'" })
      : wait.kind === "check"
        ? t({ message: `Opened in ${browser}. Pass the check there; owlit goes on by itself.`, comment: "browser: Chrome, Arc, or 'your browser'" })
        : wait.kind === "blocked"
          ? t({ message: `Opened in ${browser}. Still blocked? Try another network; owlit goes on by itself.`, comment: "browser: Chrome, Arc, or 'your browser'" })
          : t({ message: `Opened in ${browser}. Allow the extension there; owlit goes on by itself.`, comment: "browser: Chrome, Arc, or 'your browser'" })
  return (
    <StatusLine
      mark={<Spinner className="size-3.5" />}
      actions={
        <Button variant="text" size="inline" onClick={() => void actOnWait(wait)}>
          {t({ message: "Open again", comment: "button: opens the sign-in or check page in the user's browser once more" })}
        </Button>
      }
    >
      <span className="truncate">{step}</span>
    </StatusLine>
  )
}

// The site is through: its papers' PDFs coming, then what came of them. The same for Get them all's
// papers, at every site: there, a paper waiting for a sign-in isn't still coming (the site's own line
// says what to do), so the line says what came once nothing is being fetched.
function AfterLine({ followed, papers, showOnly }: { followed: FollowedWait; papers: Record<string, Paper>; showOnly: (ids: string[], label: string) => void }) {
  const { host } = followed
  const all = followed.kind === "all"
  const here = followed.ids.map((id) => papers[id]).filter((p): p is Paper => !!p)
  const got = here.filter((p) => p.pdf).length
  const still = here.filter((p) => !p.pdf && (all ? isFetching(p) : isFinding(p))).length
  const total = here.length
  if (still > 0) {
    return (
      <StatusLine mark={<Spinner className="size-3.5" />}>
        <span className="truncate">
          {all
            ? plural(total, { one: "Getting # PDF through your browser", other: "Getting # PDFs through your browser" })
            : plural(total, { one: `Getting # PDF from ${host}`, other: `Getting # PDFs from ${host}` })}
          {" · "}
          {t({ message: `${got} so far`, comment: "how many PDFs have come so far" })}
        </span>
      </StatusLine>
    )
  }
  const without = here.filter((p) => !p.pdf)
  const label = all ? t`Through your browser` : t`From ${host}`
  return (
    <StatusLine
      actions={
        <>
          <Button variant="text" size="inline" onClick={() => showOnly(here.map((p) => p.id), label)}>
            {t({ message: "Show", comment: "verb: show these papers in the Library" })}
          </Button>
          <IconButton label={t`Dismiss`} onClick={() => putAwayFollowed(host)}>
            <XIcon />
          </IconButton>
        </>
      }
    >
      <span className="truncate">
        {all
          ? plural(got, { one: "# PDF came through your browser", other: "# PDFs came through your browser" })
          : plural(got, { one: `# PDF came from ${host}`, other: `# PDFs came from ${host}` })}
        {without.length > 0 && (
          <>
            {" · "}
            {plural(without.length, { one: "# without", other: "# without" })}
          </>
        )}
      </span>
    </StatusLine>
  )
}

// Still being looked for: owlit or the extension at work, or waiting again at a site
const isFinding = (p: Paper) => {
  const wait = pdfWait(p)
  return wait === "finding" || wait === "offline" || wait === "for-sign-in" || wait === "for-check" || wait === "blocked" || wait === "for-permission"
}

// Being fetched, or in line at a site that goes on by itself
const isFetching = (p: Paper) => {
  const wait = pdfWait(p)
  return wait === "finding" || wait === "offline"
}
