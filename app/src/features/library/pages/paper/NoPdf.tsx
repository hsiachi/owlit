import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useEffect, useRef, useState } from "react"
import { isTaskFinished, type Paper, type PdfTry } from "@owlit/protocol"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { shortDate } from "@/lib/time"
import { toastError } from "@/lib/toast"
import { rpc } from "@/lib/rpc"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { tasksFor, useTasksStore } from "@/features/tasks/store"
import { libraryClient, useLibraryStore } from "../../store"
import { noPdfTitle, pdfGone, pdfWait, waitedFor, type PdfWait } from "../../lib/pdf-wait"
import { useExtension, useExtensionWaits } from "@/features/extension/store"
import { actOnWait, waitWords } from "@/features/extension/waits"

// What the card shows: where the paper stands (lib/pdf-wait.ts), or owlit looking for it now
type CardState = PdfWait | "looking"

// The steps that look for a PDF, and the route the one running is on ("arxiv", "publisher:acm")
const LOOKING = new Set(["paper.pdf"])

// "dl.acm.org" for "www.dl.acm.org"; the publisher's own name where the page had none
const hostName = (reason: PdfTry | undefined) => reason?.host?.replace(/^www\./, "") ?? ""

// The card's why line, from the try that says where the paper stands; its title is the state's one name
// as noPdfTitle says it, the paper card's too
function detailOf(state: CardState, paper: Paper, now: string | undefined): string {
  const s = paper.pdfState
  const reason = s?.reason
  const host = hostName(reason)
  const date = reason ? shortDate(reason.at) : ""
  const tried = triedSentence(s?.tried ?? [])
  switch (state) {
    case "unsought":
      return t`owlit gets it now that the paper is open.`
    case "looking":
    case "finding": {
      // The extension has it: owlit's routes are done, and the publisher is tried through the user's
      // browser, now or once its turn at the site comes
      const site = s?.extension?.host
      if (!now && site && s?.extension?.fetching) return tried ? t`${tried}; now trying ${site} through your browser.` : t`Now trying ${site} through your browser.`
      if (!now && site) return tried ? t`${tried}; owlit will try ${site} through your browser.` : t`owlit will try ${site} through your browser.`
      if (state === "finding" && pdfGone(paper)) return t`Its file was deleted or moved outside owlit. If you have it, drop it here.`
      return now ? (tried ? t`${tried}; now trying ${now}.` : t`Now trying ${now}.`) : tried ? t`${tried}.` : t`If you already have it, drop it here.`
    }
    case "for-sign-in":
    case "for-check":
    case "for-permission": {
      // Its own try's host and date when it met the wait itself, else it is one of the papers in line behind
      const site = s?.extension?.host ?? host
      const own = waitedFor(reason) ? reason : undefined
      const at = own ? hostName(own) : site
      if (state === "for-sign-in" && s?.extension?.proxied) return own ? t`${at} wants a sign-in · ${date}` : t`One sign-in to your library covers every paper waiting for it.`
      if (state === "for-sign-in") return own ? t`${at} wants a sign-in · ${date}` : t`One sign-in there covers every paper waiting at ${site}.`
      if (state === "for-check") return own ? t`${at} asked for a check · ${date}` : t`One check passed there covers every paper waiting at ${site}.`
      return own ? t`The owlit extension may not read ${site} yet · ${date}` : t`Once it may, owlit goes on with every paper waiting there.`
    }
    case "offline":
      return t`owlit couldn't reach any source of PDFs when it looked. It looks again within the hour.`
    case "not-found":
      // A check or a sign-in that stopped owlit itself, in an older record: why, as that try saw it
      if (reason?.ended === "check" || reason?.ended === "sign-in") {
        const signIn = reason.ended === "sign-in"
        if (host) return signIn ? t`${host} wanted a sign-in · ${date}` : t`${host} stopped owlit with a check · ${date}`
        return signIn ? t`The publisher wanted a sign-in · ${date}` : t`The publisher stopped owlit with a check · ${date}`
      }
      return paper.ids.doi ? (tried ? t`${tried}.` : t`owlit knows of no open copy of this paper.`) : tried ? t`${tried}. It has no DOI, so owlit could only look by its title.` : t`It has no DOI, so owlit could only look by its title.`
    case "no-access":
      return host ? t`${host} offered access instead of the PDF · ${date}` : t`The publisher offered access instead of the PDF · ${date}`
    case "not-offered":
      return t`Your library's proxy doesn't have it · ${date}`
    case "not-there": {
      const words = reason?.title ?? ""
      return words ? t`It answered “${words}” · ${date}` : t`It answered 404 · ${date}`
    }
  }
}

// What owlit does next on its own, for a card that waits on nobody
const NO_PDF: ReadonlySet<CardState> = new Set(["not-found", "no-access", "not-offered", "not-there"])

export function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // A step core is running for this paper's PDF (on add, or a daily look), and the route it is on
  const task = useTasksStore((s) => tasksFor(s.byId, paper.id).find((task) => !isTaskFinished(task) && LOOKING.has(task.kind)))
  const looking = !!task || fetching

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
      const before = pdfWait(paper)
      const found = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf: found.pdf, pdfState: found.pdfState })
      const after = pdfWait(found)
      const next = found.pdfState?.nextLook
      if (found.pdf) toast(t`PDF found`)
      // A look that ended where it began would otherwise just stop spinning
      else if (after === before && NO_PDF.has(after ?? "finding")) {
        const date = next ? shortDate(next) : ""
        toast(next ? t`Still no copy; owlit looks again on ${date}` : t`Still no copy`)
      }
    } catch (e) {
      toastError(e, t`Could not find a PDF.`)
    } finally {
      setFetching(false)
    }
  }

  // The line for the site the extension waits at, with its one thing to do
  const waits = useExtensionWaits()
  const siteWait = waits.find((w) => w.host === paper.pdfState?.extension?.host)

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  // A browser whose extension may connect; until owlit says, as if there were one, so the offer below
  // doesn't flash on a paper it doesn't belong to
  const hasExtension = useExtension((s) => !s.view || s.view.paired.length > 0)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  const wait = pdfWait(paper) ?? "finding"
  // A thread's paper nobody had opened: opening it is what fetches its PDF
  useEffect(() => {
    if (wait === "unsought") void rpc.library.seek({ id: paper.id }).catch(() => undefined)
  }, [wait, paper.id])
  const state: CardState = looking ? "looking" : wait
  const title = state === "looking" ? t`Finding a PDF…` : noPdfTitle(paper)
  const detail = detailOf(state, paper, task?.progress?.note && routeName(task.progress.note))
  const lost = state === "finding" && pdfGone(paper)
  const working = (state === "looking" || state === "finding") && !lost
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
  const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
  // Nothing more owlit can try alone: its own routes found no copy, and no extension in the user's
  // browser may try with their library's access. The publisher's page is a plain link; nothing watches
  // what happens there.
  const doi = paper.ids.doi
  // owlit couldn't get it alone: its own routes found no copy of a paper a publisher has
  const alone = state === "not-found" && !!doi
  const noExtension = alone && !hasExtension
  const askAccess = alone && (!hasExtension || proxyMissing)
  // The page opens in the person's browser, where owlit can't follow: the card says the next step
  const [opened, setOpened] = useState(false)
  const openPage = () => {
    window.open(`https://doi.org/${doi}`, "_blank", "noreferrer")
    setOpened(true)
  }

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
          state === "for-sign-in" || state === "for-check" || state === "for-permission" ? (
            <>
              {siteWait ? (
                <Button size="sm" onClick={() => void actOnWait(siteWait)}>
                  {waitWords(siteWait).action}
                </Button>
              ) : (
                // No line for it (owlit restarted since): looking again hands it to the extension again
                lookAgainButton(true)
              )}
              {chooseFile}
            </>
          ) : lost ? (
            <>
              {lookAgainButton(true)}
              {chooseFile}
            </>
          ) : state === "looking" || state === "finding" || state === "unsought" ? (
            chooseFile
          ) : noExtension ? (
            // No extension to try with the person's access: the page and the file come first
            <>
              <Button size="sm" onClick={openPage}>
                {t({ message: "Open the page", comment: "button: opens the paper's page at its publisher in the user's browser" })}
              </Button>
              {chooseFile}
            </>
          ) : (
            // owlit's own look, which may find another copy
            <>
              {lookAgainButton(true)}
              {chooseFile}
            </>
          )
        }
      >
        {opened && <p className="max-w-72 text-sm text-foreground">{t`Download it there, then drop it here.`}</p>}
        {NO_PDF.has(state) && (
          <p className="max-w-72 text-sm text-muted-foreground">{nextLook ? t`owlit looks again on ${nextDate}` : t`owlit won't look again`}</p>
        )}
        {/* The first paywalled PDF is where owlit asks for the library's access: the proxy, and the
            extension that uses it in the person's browser (Settings › Papers, the two rows together) */}
        {askAccess && (
          <p className="max-w-72 text-sm text-muted-foreground">
            <Trans>
              Use your library's access ·{" "}
              <button type="button" className={linkClass} onClick={() => openSettings("proxy")}>
                Set up
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
