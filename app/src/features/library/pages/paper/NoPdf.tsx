import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useRef, useState } from "react"
import { isTaskFinished, type Paper, type PdfTry } from "@owlit/protocol"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { shortDate } from "@/lib/time"
import { toastError } from "@/lib/toast"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { resumeTask, tasksFor, useTasksStore } from "@/features/tasks/store"
import { continueLabel, getInBrowser, showBrowser, stoppedLine, useFromBrowserRun } from "../../from-browser"
import { libraryClient, useLibraryStore } from "../../store"
import { pdfWait, type PdfWait } from "../../lib/pdf-wait"

// What the card shows: where the paper stands (lib/pdf-wait.ts), or owlit looking for it now
type CardState = PdfWait | "looking"

// A run in the user's browser, or a file for them to confirm, comes before owlit's own looking
const BEFORE_LOOKING: ReadonlySet<CardState> = new Set(["offered", "run-stopped", "page", "queued", "opened"])

// The steps that look for a PDF, and the route the one running is on ("arxiv", "publisher:acm")
const LOOKING = new Set(["paper.pdf", "paper.pdf.browser"])

// "dl.acm.org" for "www.dl.acm.org"; the publisher's own name where the page had none
const hostName = (reason: PdfTry | undefined) => reason?.host?.replace(/^www\./, "") ?? ""

// The card's title and its why line (from the try that says where the paper stands), in one place, so a
// title says the state's one name with the host and the why says what that try found
function card(state: CardState, paper: Paper, now: string | undefined): { title: string; detail: string } {
  const s = paper.pdfState
  const reason = s?.reason
  const host = hostName(reason)
  const date = reason ? shortDate(reason.at) : ""
  const browser = s?.run?.browser
  const tried = triedSentence(s?.tried ?? [])
  switch (state) {
    case "looking":
    case "finding":
      return { title: t`Finding a PDF…`, detail: now ? (tried ? t`${tried}; now trying ${now}.` : t`Now trying ${now}.`) : tried ? t`${tried}.` : t`If you already have it, drop it here.` }
    case "offline":
      return { title: t`Waiting for the network`, detail: t`owlit couldn't reach any source of PDFs when it looked. It looks again the next time it opens.` }
    case "not-found":
      return {
        title: t`No PDF found`,
        detail: paper.ids.doi ? (tried ? t`${tried}.` : t`owlit knows of no open copy of this paper.`) : tried ? t`${tried}. It has no DOI, so owlit could only look by its title.` : t`It has no DOI, so owlit could only look by its title.`,
      }
    case "no-access":
      return { title: t`No access through your library`, detail: host ? t`${host} offered access instead of the PDF · ${date}` : t`The publisher offered access instead of the PDF · ${date}` }
    case "not-offered":
      return { title: t`Your library doesn't offer this paper`, detail: t`Your library's proxy doesn't have it · ${date}` }
    case "not-there": {
      const words = reason?.title ?? ""
      return {
        title: host ? t`${host} has no PDF of this paper` : t`The publisher has no PDF of this paper`,
        detail: words ? t`It answered “${words}” · ${date}` : t`It answered 404 · ${date}`,
      }
    }
    case "for-browser":
      return {
        title: t`Try it in your browser`,
        detail:
          reason?.ended === "sign-in"
            ? host
              ? t`${host} wants a sign-in · ${date}`
              : t`The publisher wants a sign-in · ${date}`
            : host
              ? t`${host} stopped owlit with a check · ${date}`
              : t`The publisher stopped owlit with a check · ${date}`,
      }
    case "nothing-came":
      return {
        title: t`Nothing came from your browser`,
        detail: browser
          ? t`The page in ${browser} may say you have no access to this paper, or ${browser} may be asking you something: a check, a sign-in, or whether the site may download files.`
          : t`The page may say you have no access to this paper, or your browser may be asking you something: a check, a sign-in, or whether the site may download files.`,
      }
    case "queued":
      return { title: t`Waiting its turn`, detail: t`owlit opens papers in your browser one at a time, a few seconds apart.` }
    case "opened":
      return {
        title: t`Getting it from your browser…`,
        detail: browser ? t`${browser} saves it to Downloads, and owlit takes it from there.` : t`Your browser saves it to Downloads, and owlit takes it from there.`,
      }
    case "page":
      return browser
        ? { title: t`Save the PDF from the page in ${browser}`, detail: t`The paper's page is open in ${browser}. Save its PDF there, and owlit takes it from Downloads.` }
        : { title: t`Save the PDF from the page in your browser`, detail: t`The paper's page is open in your browser. Save its PDF there, and owlit takes it from Downloads.` }
    case "run-stopped": {
      const why = s?.run?.why
      return {
        title: stoppedLine(paper),
        detail:
          why === "sign-in"
            ? t`Getting PDFs waits for you to sign in there. Once you have, owlit tries this paper again.`
            : why === "check"
              ? t`Getting PDFs waits for you to pass the check there. Then owlit goes on.`
              : t`Getting PDFs waits for you to look at the page there. Then owlit goes on.`,
      }
    }
    case "offered": {
      const file = s?.run?.offered ?? ""
      return { title: t`Is this the paper's PDF?`, detail: t`${file} just arrived in your Downloads, and owlit can't tell whose it is.` }
    }
  }
}

// What owlit does next on its own, for a card that waits on nobody
const NO_PDF: ReadonlySet<CardState> = new Set(["not-found", "no-access", "not-offered", "not-there", "for-browser", "nothing-came"])

export function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // A step core is running for this paper's PDF (on add, or a daily look), and the route it is on
  const task = useTasksStore((s) => tasksFor(s.byId, paper.id).find((task) => !isTaskFinished(task) && LOOKING.has(task.kind)))
  const looking = !!task || fetching
  const run = useFromBrowserRun()

  const takeDownload = async (take: boolean) => {
    const offered = paper.pdfState?.run?.offered
    try {
      const found = await libraryClient.takeDownload!(paper, take)
      updatePaper(paper.id, { pdf: found.pdf, pdfState: found.pdfState })
      if (found.pdf) toast(t`PDF attached`, { description: offered })
    } catch (e) {
      toastError(e, t`Couldn't take that file.`)
    }
  }

  const attach = async (files: ArrayLike<File>) => {
    const file = files[0]
    if (!file) return
    try {
      const pdf = await libraryClient.attachPdf(paper, file)
      updatePaper(paper.id, { pdf, pdfState: undefined })
      toast(t`PDF attached`, { description: file.name })
    } catch (e) {
      toastError(e, t`Couldn't attach that file.`)
    }
  }

  // Look again: owlit's own look, which ends with the PDF or with where the paper stands, as core says
  const lookAgain = async () => {
    setFetching(true)
    try {
      const found = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf: found.pdf, pdfState: found.pdfState })
      if (found.pdf) toast(t`PDF found`)
    } catch (e) {
      toastError(e, t`Could not find a PDF.`)
    } finally {
      setFetching(false)
    }
  }

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  const wait = pdfWait(paper) ?? "finding"
  const state: CardState = looking && !BEFORE_LOOKING.has(wait) ? "looking" : wait
  const { title, detail } = card(state, paper, task?.progress?.note && routeName(task.progress.note))
  const working = state === "looking" || state === "finding" || state === "queued" || state === "opened"
  const nextLook = paper.pdfState?.nextLook
  const nextDate = nextLook ? shortDate(nextLook) : ""
  const chooseFile = (
    <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
      {t`Choose file`}
    </Button>
  )
  const lookAgainButton = (primary: boolean) => (
    <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => void lookAgain()} disabled={looking}>
      {t({ message: "Look again", comment: "button: owlit looks for the paper's PDF again, by its own routes" })}
    </Button>
  )
  const inYourBrowser = (again: boolean, primary: boolean) => (
    <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => void getInBrowser([paper.id])}>
      {again ? t`Open in your browser again` : t`Get it in your browser`}
    </Button>
  )
  const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
  const byYou = paper.pdfState?.reason?.by === "you"

  return (
    <div className="flex flex-1 items-center justify-center p-6" {...dropProps}>
      <DropCard
        active={dragging}
        title={
          <>
            {working && <Spinner />}
            {title}
          </>
        }
        detail={detail}
        actions={
          state === "offered" ? (
            <>
              <Button size="sm" onClick={() => void takeDownload(true)}>
                {t({ message: "Use it", comment: "button: take the downloaded file as the paper's PDF" })}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void takeDownload(false)}>
                {t({ message: "Not this", comment: "button: the downloaded file is not the paper's PDF" })}
              </Button>
            </>
          ) : state === "for-browser" ? (
            <>
              {inYourBrowser(false, true)}
              {chooseFile}
            </>
          ) : state === "queued" || state === "looking" || state === "finding" ? (
            chooseFile
          ) : state === "opened" || state === "page" ? (
            <>
              <Button size="sm" variant={state === "page" ? "default" : "outline"} onClick={() => void showBrowser(paper.id)}>
                {t`Show browser`}
              </Button>
              {chooseFile}
            </>
          ) : state === "run-stopped" ? (
            <>
              <Button size="sm" onClick={() => void showBrowser(paper.id)}>
                {t`Show browser`}
              </Button>
              <Button variant="outline" size="sm" disabled={!run} onClick={() => run && void resumeTask(run.id)}>
                {continueLabel(paper)}
              </Button>
            </>
          ) : state === "no-access" || state === "not-offered" || state === "nothing-came" ? (
            <>
              {/* The user's browser again: through their library, which owlit's own look can't use */}
              {inYourBrowser(byYou, false)}
              {chooseFile}
            </>
          ) : (
            // Not found, not there, offline: owlit's own look, which may find another copy
            <>
              {lookAgainButton(true)}
              {chooseFile}
            </>
          )
        }
      >
        {NO_PDF.has(state) && (
          <p className="max-w-72 text-sm text-muted-foreground">{nextLook ? t`owlit looks again on ${nextDate}` : t`owlit won't look again`}</p>
        )}
        {/* No copy owlit can get, and the publisher's page gave its browser nothing: the user's own
            browser (their access, their sign-ins) may still get it */}
        {state === "not-found" && paper.ids.doi && (
          <p className="max-w-72 text-sm text-muted-foreground">
            <Trans>
              Or{" "}
              <button type="button" className={linkClass} onClick={() => void getInBrowser([paper.id])}>
                get it in your browser
              </button>
            </Trans>
          </p>
        )}
        {/* A publisher's paper may be one sign-in away: say so where the PDF is missing */}
        {state === "not-found" && paper.ids.doi && proxyMissing && (
          <p className="max-w-72 text-sm text-muted-foreground">
            <Trans>
              Your library may have it.{" "}
              <button type="button" className={linkClass} onClick={() => openSettings("proxy")}>
                Set up library proxy
              </button>
            </Trans>
          </p>
        )}
      </DropCard>
      <PdfFileInput ref={fileInput} onFiles={(files) => void attach(files)} />
    </div>
  )
}

// What a route is called on the card: arXiv, Unpaywall, the publisher, the library proxy
function routeName(route: string) {
  if (route === "arxiv") return "arXiv"
  if (route.endsWith(":proxied")) return t`the library proxy`
  if (route.startsWith("publisher") || route.startsWith("api:") || route.startsWith("browser:")) return t`the publisher`
  if (route.startsWith("unpaywall")) return "Unpaywall"
  if (route.startsWith("open-access")) return t`open-access links`
  if (route.startsWith("title:")) return t`a search by its title`
  if (route === "acl-anthology") return t`the ACL Anthology`
  return ""
}

// "Tried arXiv, Unpaywall and the publisher" from the routes of the tries since the last PDF, or ""
function triedSentence(tried: PdfTry[]) {
  const names = [...new Set(tried.flatMap((t) => (t.route && t.ended !== "pdf" ? [routeName(t.route)] : [])))].filter(Boolean)
  if (!names.length) return ""
  const list = joinAnd(names)
  return t`Tried ${list}`
}
