import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useRef, useState } from "react"
import { isTaskFinished } from "@owlit/protocol"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { notifyWhenAway } from "@/lib/notify"
import { toastError } from "@/lib/toast"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { resumeTask, tasksFor, useTasksStore } from "@/features/tasks/store"
import { PublisherNeedsUser } from "../../client"
import { continueLabel, getInBrowser, showBrowser, stoppedLine, useFromBrowserRun } from "../../from-browser"
import { libraryClient, useLibraryStore } from "../../store"
import type { Paper } from "../../types"
import { pdfWait, type PdfWait } from "../../lib/pdf-wait"

// What the card shows: where the paper stands (lib/pdf-wait.ts), or owlit looking for it now
type CardState = PdfWait | "looking"

// Being got from the user's browser, or a file for them to confirm, comes before owlit's own looking
const BEFORE_LOOKING: ReadonlySet<CardState> = new Set(["offered", "run-stopped", "page", "queued", "opened", "missed"])

const card = (state: CardState, paper?: Paper): { title: string; detail: string } => {
  const browser = paper?.noPdf?.fromBrowser?.browser
  const opens = paper?.noPdf?.browserOpens
  switch (state) {
    case "looking":
      return { title: t`Looking for a PDF…`, detail: t`If you already have it, drop it here.` }
    // Its detail names the file, so it is said where the card is drawn
    case "offered":
      return { title: t`Is this the paper's PDF?`, detail: "" }
    case "not-found":
      return { title: t`No PDF found`, detail: t`Drop a PDF here if you have it.` }
    case "not-yet":
      return { title: t`No PDF yet`, detail: t`Drop a PDF here, or let owlit look for an open-access copy.` }
    case "browser":
      return {
        title: t`Your browser can get this PDF`,
        detail:
          opens === "page"
            ? t`owlit can't get it by itself. It opens the paper's page in your browser: save the PDF there, and owlit takes it from Downloads.`
            : t`owlit can't get it by itself. Your browser saves the PDF to Downloads, and owlit takes it from there.`,
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
      const why = paper?.noPdf?.fromBrowser?.why
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
    case "no-access": {
      const said = paper?.noPdf?.noAccess
      const title = said?.title ?? ""
      const host = said?.host ?? ""
      return said?.refused
        ? { title: t`Your library doesn't offer this paper`, detail: title ? t`Its proxy answered “${title}”.` : t`Its proxy turned the paper away.` }
        : {
            title: t`No access through your library`,
            detail: host ? t`Your browser reached ${host}, which showed its page instead of the PDF. Your library may not subscribe to this journal.` : t`The publisher showed its page instead of the PDF. Your library may not subscribe to this journal.`,
          }
    }
    case "missing": {
      const said = paper?.noPdf?.noAccess
      const title = said?.title ?? ""
      const host = said?.host ?? ""
      return {
        title: host ? t`${host} has no PDF of this paper` : t`The publisher has no PDF of this paper`,
        detail: title ? t`It answered “${title}”. The paper may be kept somewhere else: drop its PDF here if you find it.` : t`The paper may be kept somewhere else: drop its PDF here if you find it.`,
      }
    }
    case "missed":
      return {
        title: t`Nothing came from your browser`,
        detail: browser
          ? t`The page in ${browser} may say you have no access to this paper, or ${browser} may be asking you something: a check, a sign-in, or whether the site may download files.`
          : t`The page may say you have no access to this paper, or your browser may be asking you something: a check, a sign-in, or whether the site may download files.`,
      }
  }
}

export function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // A paper.pdf task core is running for this paper (on add, or a daily retry)
  const looking = useTasksStore((s) => tasksFor(s.byId, paper.id).some((task) => !isTaskFinished(task) && (task.kind === "paper.pdf" || task.kind === "paper.pdf.browser"))) || fetching
  const offered = paper.noPdf?.offered
  const run = useFromBrowserRun()

  const takeDownload = async (take: boolean) => {
    try {
      const found = await libraryClient.takeDownload!(paper, take)
      updatePaper(paper.id, { pdf: found.pdf, noPdf: found.noPdf })
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
      updatePaper(paper.id, { pdf, noPdf: undefined })
      toast(t`PDF attached`, { description: file.name })
    } catch (e) {
      toastError(e, t`Couldn't attach that file.`)
    }
  }

  const fetchPdf = async () => {
    setFetching(true)
    try {
      const pdf = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf })
      toast(t`PDF found`)
    } catch (e) {
      if (e instanceof PublisherNeedsUser) {
        // The card now offers the user's browser; a system notification only if the user went elsewhere
        updatePaper(paper.id, { noPdf: { ...(paper.noPdf ?? { tried: [], at: Date.now() }), needs: e.needs } })
        if (document.hidden) notifyNeeds(paper)
      } else toastError(e, t`Could not find a PDF.`)
    } finally {
      setFetching(false)
    }
  }

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  const wait = pdfWait(paper) ?? "not-yet"
  const state: CardState = looking && !BEFORE_LOOKING.has(wait) ? "looking" : wait
  const { title, detail: plain } = card(state, paper)
  const working = state === "looking" || state === "queued" || state === "opened"
  const tried = triedSentence(paper.noPdf?.tried ?? [])
  const file = offered ?? ""
  // What was tried and what to do, as one message so a language can join the two sentences its own way
  const detail =
    state === "not-found"
      ? t`${tried} Drop a PDF here if you have it.`
      : state === "offered"
        ? t`${file} just arrived in your Downloads, and owlit can't tell whose it is.`
        : plain
  const chooseFile = (
    <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
      {t`Choose file`}
    </Button>
  )
  const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"

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
          ) : state === "browser" ? (
            <>
              <Button size="sm" onClick={() => void getInBrowser([paper.id])}>
                {t`Get it in your browser`}
              </Button>
              {chooseFile}
            </>
          ) : state === "queued" ? (
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
          ) : state === "no-access" || state === "missing" ? (
            <>
              {/* Nothing at the address the browser went to: owlit looks again for another copy rather
                  than sending it back there */}
              <Button size="sm" variant="outline" disabled={looking} onClick={() => void (state === "missing" ? fetchPdf() : getInBrowser([paper.id]))}>
                {t`Try again`}
              </Button>
              {chooseFile}
            </>
          ) : state === "missed" ? (
            <>
              <Button size="sm" onClick={() => void showBrowser(paper.id)}>
                {t`Show browser`}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void getInBrowser([paper.id])}>
                {t`Try again`}
              </Button>
              {chooseFile}
            </>
          ) : (
            <>
              <Button size="sm" onClick={fetchPdf} disabled={looking}>
                {paper.noPdf ? t`Try again` : t`Find PDF`}
              </Button>
              {chooseFile}
            </>
          )
        }
      >
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

// The user went elsewhere while owlit looked: a system notification, which brings owlit back
const notifyNeeds = (paper: Paper) => notifyWhenAway({ title: card("browser", paper).title, body: paper.title })

// "Tried arXiv, Unpaywall and the publisher." from acquisition route names
function triedSentence(routes: string[]) {
  const nameOf = (r: string) =>
    r === "arxiv" ? "arXiv" : r.startsWith("publisher") || r.startsWith("browser:") && !r.endsWith(":proxied") ? t`the publisher` : r.endsWith(":proxied") ? t`the library proxy` : r.startsWith("unpaywall") ? "Unpaywall" : r === "open-access" ? t`open-access links` : ""
  const names = [...new Set(routes.map(nameOf))].filter(Boolean)
  if (!names.length) return t`owlit knows of no open copy of this paper.`
  const list = joinAnd(names)
  return t`Tried ${list}.`
}
