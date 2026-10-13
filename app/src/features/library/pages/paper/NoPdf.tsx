import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { bridge } from "@/lib/rpc"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { cancelTask, openTasksFor, useTasksStore } from "@/features/tasks/store"
import { useCheckQueue, useNextCheck } from "../../check-queue"
import { PublisherNeedsUser } from "../../client"
import { citationLabel } from "../../lib/format"
import { useTakeParam } from "../../lib/use-take-param"
import { libraryClient, useLibraryStore } from "../../store"
import type { Paper } from "../../types"

type CardState = "looking" | "sign-in" | "check" | "blocked" | "in-browser" | "offered" | "not-found" | "not-yet"

const card = (state: CardState): { title: string; detail: string } => {
  switch (state) {
    case "looking":
      return { title: t`Looking for a PDF…`, detail: t`If you already have it, drop it here.` }
    case "sign-in":
      return { title: t`The publisher wants you to sign in`, detail: t`Sign in on its page here and owlit fetches the PDF.` }
    case "check":
      return { title: t`The publisher wants a quick check`, detail: t`It wants to see a person before it hands over the PDF. Open its page here to do that.` }
    case "blocked":
      return {
        title: t`The publisher isn't letting owlit in`,
        detail: t`Its check keeps coming back. Save the PDF from your own browser and owlit takes it from your Downloads.`,
      }
    case "in-browser":
      return { title: t`Waiting for the PDF from your browser`, detail: t`Save the PDF from the publisher's page. owlit takes it from your Downloads folder.` }
    // Its detail names the file, so it is said where the card is drawn
    case "offered":
      return { title: t`Is this the paper's PDF?`, detail: "" }
    case "not-found":
      return { title: t`No PDF found`, detail: t`Drop a PDF here if you have it.` }
    case "not-yet":
      return { title: t`No PDF yet`, detail: t`Drop a PDF here, or let owlit look for an open-access copy.` }
  }
}

export function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const canCheck = !!libraryClient.checkPublisher
  // Check now: the publisher's page takes the card's place
  const [checking, setChecking] = useState(false)
  // Arriving from Home's "Waiting on you" (?check=1) goes straight to the publisher's page
  // Going through several papers' checks in turn (Home's grouped line, ?queue=1): taken with the check
  const [inQueue, setInQueue] = useState(false)
  useTakeParam(
    "check",
    (value, params) => {
      if (value === "1" && paper.noPdf?.needs && paper.noPdf.needs !== "blocked" && canCheck) setChecking(true)
      setInQueue(params.get("queue") === "1")
    },
    ["queue"],
  )
  const fileInput = useRef<HTMLInputElement>(null)
  // A paper.pdf task core is running for this paper (on add, or a daily retry)
  const looking = useTasksStore((s) => openTasksFor(s, paper.id).some((task) => task.kind === "paper.pdf" || task.kind === "paper.pdf.browser")) || fetching
  const needs = paper.noPdf?.needs
  const canOpen = !!libraryClient.openInBrowser && !!(paper.ids.doi || paper.ids.arxiv)
  // Opened in the user's browser: core looks in their Downloads until `until`
  const inBrowser = paper.noPdf?.inBrowser
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!inBrowser || inBrowser.until <= Date.now()) return
    const timer = setTimeout(() => setNow(Date.now()), inBrowser.until - Date.now() + 100)
    return () => clearTimeout(timer)
  }, [inBrowser])
  const watching = !!inBrowser && inBrowser.until > now

  const openInBrowser = async () => {
    try {
      const found = await libraryClient.openInBrowser!(paper)
      updatePaper(paper.id, { noPdf: found.noPdf })
      setNow(Date.now())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t`Couldn't open your browser.`)
    }
  }

  const takeDownload = async (take: boolean) => {
    try {
      const found = await libraryClient.takeDownload!(paper, take)
      updatePaper(paper.id, { pdf: found.pdf, noPdf: found.noPdf })
      if (found.pdf) toast(t`PDF attached`, { description: inBrowser?.offered })
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
        // The card now asks for the check; a system notification only if the user went elsewhere
        updatePaper(paper.id, { noPdf: { ...(paper.noPdf ?? { tried: [], at: Date.now() }), needs: e.needs } })
        if (document.hidden) notifyNeeds(paper, e.needs)
      } else toast.error(e instanceof Error ? e.message : t`Could not find a PDF.`)
    } finally {
      setFetching(false)
    }
  }

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  if (checking) return <PublisherPage paper={paper} inQueue={inQueue} onEnd={() => setChecking(false)} />

  const state: CardState = looking
    ? "looking"
    : inBrowser?.offered
      ? "offered"
      : watching
        ? "in-browser"
        : (needs ?? (paper.noPdf ? "not-found" : "not-yet"))
  const { title, detail: plain } = card(state)
  const tried = triedSentence(paper.noPdf?.tried ?? [])
  const file = inBrowser?.offered ?? ""
  // What was tried and what to do, as one message so a language can join the two sentences its own way
  const detail =
    state === "not-found"
      ? t`${tried} Drop a PDF here if you have it.`
      : state === "offered"
        ? t`${file} just arrived in your Downloads, and owlit can't tell whose it is.`
        : plain

  return (
    <div className="flex flex-1 items-center justify-center p-6" {...dropProps}>
      <DropCard
        active={dragging}
        title={
          <>
            {looking && <Spinner />}
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
          ) : (state === "blocked" || state === "in-browser") && canOpen ? (
            <>
              <Button size="sm" variant={state === "in-browser" ? "outline" : "default"} onClick={() => void openInBrowser()}>
                {state === "in-browser" ? t`Open again` : t`Open in browser`}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                {t`Choose file`}
              </Button>
            </>
          ) : (
            <>
              {needs && needs !== "blocked" && canCheck && !looking ? (
                <Button size="sm" onClick={() => setChecking(true)}>
                  {needs === "sign-in" ? t`Sign in` : t`Check now`}
                </Button>
              ) : (
                <Button size="sm" onClick={fetchPdf} disabled={looking}>
                  {paper.noPdf ? t`Try again` : t`Find PDF`}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                {t`Choose file`}
              </Button>
            </>
          )
        }
      >
        {/* A check owlit's browser may not get past: the user's own browser is the other way */}
        {state === "check" && canOpen && (
          <p className="max-w-72 text-sm text-muted-foreground">
            <Trans>
              Or{" "}
              <button type="button" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => void openInBrowser()}>
                open it in your browser
              </button>
            </Trans>
          </p>
        )}
        {/* A publisher's paper may be one sign-in away: say so where the PDF is missing */}
        {state === "not-found" && paper.ids.doi && proxyMissing && (
          <p className="max-w-72 text-sm text-muted-foreground">
            <Trans>
              Your library may have it.{" "}
              <button type="button" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => openSettings("proxy")}>
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

// Check now: the publisher's page fills the reader's place (the desktop app draws it over the box this
// reserves) under one line saying what it waits for. Through, the reader takes over; Cancel, or
// leaving the paper, ends the run and the card comes back. In a run of several, a PDF that arrives
// opens the next paper's publisher instead, and Skip goes on without this one.
function PublisherPage({ paper, inQueue, onEnd }: { paper: Paper; inQueue: boolean; onEnd: () => void }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const navigate = useNavigate()
  const next = useNextCheck(inQueue ? paper.id : "")
  const nextPaper = useLibraryStore((s) => (next ? s.papers[next] : undefined))
  const nextRef = useRef(next)
  nextRef.current = next
  const goNext = (id: string) => navigate(`/library/${id}?check=1&queue=1`)
  const box = useRef<HTMLDivElement>(null)
  const task = useTasksStore((s) => openCheck(s, paper.id))
  const mounted = useRef(false)
  const end = useRef(onEnd)
  end.current = onEnd

  // Keep the page over the box as the layout moves
  useEffect(() => {
    const el = box.current
    if (!el || !bridge) return
    const place = () => {
      const r = el.getBoundingClientRect()
      bridge?.setPublisherView({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    window.addEventListener("resize", place)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", place)
      bridge?.setPublisherView(null)
    }
  }, [])

  // One run per visit; leaving the paper cancels it
  useEffect(() => {
    mounted.current = true
    let live = true
    const run = libraryClient.checkPublisher!(paper)
      .then((found) => {
        // Before the PDF lands here, so the reader doesn't flash up on the way to the next paper. Only
        // from the page still showing: StrictMode's first mount also gets an answer.
        if (live && found.pdf && nextRef.current) goNext(nextRef.current)
        else if (live && found.pdf && inQueue) useCheckQueue.getState().end()
        updatePaper(paper.id, { pdf: found.pdf, noPdf: found.noPdf })
        if (found.pdf) toast(t`PDF found`, inQueue ? { description: citationLabel(paper) } : undefined)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : t`owlit couldn't open the publisher's page.`))
      .finally(() => live && end.current())
    return () => {
      live = false
      mounted.current = false
      // Looked at a moment later: StrictMode mounts the page again at once. The run's task may not have
      // reached this window yet; then it is cancelled when it does, unless the run ends first.
      setTimeout(() => {
        if (mounted.current) return
        const cancelOpen = (s: Parameters<typeof openCheck>[0]) => {
          const open = openCheck(s, paper.id)
          if (open) void cancelTask(open.id)
          return !!open
        }
        if (cancelOpen(useTasksStore.getState())) return
        const unsubscribe = useTasksStore.subscribe((s) => cancelOpen(s) && unsubscribe())
        void run.finally(unsubscribe)
      })
    }
    // paper.id is the run's subject; the page remounts for another paper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id])

  const line =
    task?.state === "waiting_for_you"
      ? task.waiting?.detail ?? t`The publisher wants you on its page.`
      : t`Opening the publisher's page…`
  const nextName = nextPaper ? citationLabel(nextPaper) : t`the next paper`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-4 text-sm text-muted-foreground">
        {task?.state !== "waiting_for_you" && <Spinner />}
        <span className="min-w-0 flex-1 truncate">{line}</span>
        {next && (
          <Tip label={t`Next: ${nextName}`}>
            <Button variant="ghost" size="sm" onClick={() => goNext(next)}>
              {t({ message: "Skip", comment: "button: go on to the next paper without this one" })}
            </Button>
          </Tip>
        )}
        <Button variant="ghost" size="sm" onClick={() => task && void cancelTask(task.id)} disabled={!task}>
          {t`Cancel`}
        </Button>
      </div>
      {/* The publisher's page is drawn over this box by the desktop app */}
      <div ref={box} className="min-h-0 flex-1 bg-background" />
    </div>
  )
}

const openCheck = (s: Parameters<typeof openTasksFor>[0], paperId: string) =>
  openTasksFor(s, paperId).find((task) => task.kind === "paper.pdf.check")

// The user went elsewhere while owlit looked: a system notification, which brings owlit back
function notifyNeeds(paper: Paper, needs: "check" | "sign-in" | "blocked") {
  if (typeof Notification === "undefined") return
  const notification = new Notification(card(needs).title, { body: paper.title })
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
