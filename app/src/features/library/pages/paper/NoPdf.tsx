import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"
import { PublisherNeedsUser } from "../../client"
import { getInBrowser, showBrowser } from "../../from-browser"
import { libraryClient, useLibraryStore } from "../../store"
import type { Paper } from "../../types"

type CardState =
  | "looking"
  | "offered"
  | "not-found"
  | "not-yet"
  // owlit couldn't get it alone, and the user's own browser is the way (from-browser.ts): waiting for
  // them, waiting its turn in a run, opened there, its page opened for them to save the PDF from, or
  // opened with nothing arriving
  | "browser"
  | "browser-queued"
  | "browser-opened"
  | "browser-page"
  | "browser-missed"

const card = (state: CardState, browser?: string, opens?: "pdf" | "page"): { title: string; detail: string } => {
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
    case "browser-queued":
      return { title: t`Waiting its turn`, detail: t`owlit opens papers in your browser one at a time, a few seconds apart.` }
    case "browser-opened":
      return {
        title: t`Getting it from your browser…`,
        detail: browser ? t`${browser} saves it to Downloads, and owlit takes it from there.` : t`Your browser saves it to Downloads, and owlit takes it from there.`,
      }
    case "browser-page":
      return browser
        ? { title: t`Save the PDF from the page in ${browser}`, detail: t`The paper's page is open in ${browser}. Save its PDF there, and owlit takes it from Downloads.` }
        : { title: t`Save the PDF from the page in your browser`, detail: t`The paper's page is open in your browser. Save its PDF there, and owlit takes it from Downloads.` }
    case "browser-missed":
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
  const looking = useTasksStore((s) => openTasksFor(s, paper.id).some((task) => task.kind === "paper.pdf" || task.kind === "paper.pdf.browser")) || fetching
  const needs = paper.noPdf?.needs
  const fromBrowser = paper.noPdf?.fromBrowser
  const offered = paper.noPdf?.offered

  const takeDownload = async (take: boolean) => {
    try {
      const found = await libraryClient.takeDownload!(paper, take)
      updatePaper(paper.id, { pdf: found.pdf, noPdf: found.noPdf })
      if (found.pdf) toast(t`PDF attached`, { description: offered })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t`Couldn't take that file.`)
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
      toast.error(e instanceof Error ? e.message : t`Couldn't attach that file.`)
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
      } else toast.error(e instanceof Error ? e.message : t`Could not find a PDF.`)
    } finally {
      setFetching(false)
    }
  }

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  // Being got from the user's browser comes before owlit's own looking
  const state: CardState = offered
    ? "offered"
    : fromBrowser
      ? `browser-${fromBrowser.state}`
      : looking
        ? "looking"
        : (needs ?? (paper.noPdf ? "not-found" : "not-yet"))
  const { title, detail: plain } = card(state, fromBrowser?.browser, paper.noPdf?.browserOpens)
  const working = state === "looking" || state === "browser-queued" || state === "browser-opened"
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
          ) : state === "browser-queued" ? (
            chooseFile
          ) : state === "browser-opened" || state === "browser-page" ? (
            <>
              <Button size="sm" variant={state === "browser-page" ? "default" : "outline"} onClick={() => void showBrowser()}>
                {t`Show browser`}
              </Button>
              {chooseFile}
            </>
          ) : state === "browser-missed" ? (
            <>
              <Button size="sm" onClick={() => void showBrowser()}>
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
function notifyNeeds(paper: Paper) {
  if (typeof Notification === "undefined") return
  const notification = new Notification(card("browser").title, { body: paper.title })
  notification.onclick = () => window.focus()
}

// "Tried arXiv, Unpaywall and the publisher." from acquisition route names
function triedSentence(routes: string[]) {
  const nameOf = (r: string) =>
    r === "arxiv" ? "arXiv" : r.startsWith("publisher") || r.startsWith("browser:") && !r.endsWith(":proxied") ? t`the publisher` : r.endsWith(":proxied") ? t`the library proxy` : r.startsWith("unpaywall") ? "Unpaywall" : r === "open-access" ? t`open-access links` : ""
  const names = [...new Set(routes.map(nameOf))].filter(Boolean)
  if (!names.length) return t`owlit knows of no open copy of this paper.`
  const list = joinAnd(names)
  return t`Tried ${list}.`
}
