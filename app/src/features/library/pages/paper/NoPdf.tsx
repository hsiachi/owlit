import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { DropCard } from "@/components/empty-place"
import { PdfFileInput } from "@/components/file-drop"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useFileDrop } from "@/hooks/use-file-drop"
import { bridge } from "@/lib/rpc"
import { joinAnd } from "@/lib/words"
import { openSettings, useSettings } from "@/features/settings/store"
import { cancelTask, openTasksFor, useTasksStore } from "@/features/tasks/store"
import { PublisherNeedsUser } from "../../client"
import { useTakeParam } from "../../lib/use-take-param"
import { libraryClient, useLibraryStore } from "../../store"
import type { Paper } from "../../types"

type CardState = "looking" | "sign-in" | "check" | "not-found" | "not-yet"

const CARD: Record<CardState, { title: string; detail: string }> = {
  looking: { title: "Looking for a PDF…", detail: "If you already have it, drop it here." },
  "sign-in": { title: "The publisher wants you to sign in", detail: "Sign in on its page here and owlit fetches the PDF." },
  check: { title: "The publisher wants a quick check", detail: "It wants to see a person before it hands over the PDF. Open its page here to do that." },
  "not-found": { title: "No PDF found", detail: "Drop a PDF here if you have it." },
  "not-yet": { title: "No PDF yet", detail: "Drop a PDF here, or let owlit look for an open-access copy." },
}

export function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const canCheck = !!libraryClient.checkPublisher
  // Check now: the publisher's page takes the card's place
  const [checking, setChecking] = useState(false)
  // Arriving from Home's "Waiting on you" (?check=1) goes straight to the publisher's page
  useTakeParam("check", (value) => {
    if (value === "1" && paper.noPdf?.needs && canCheck) setChecking(true)
  })
  const fileInput = useRef<HTMLInputElement>(null)
  // A paper.pdf task core is running for this paper (on add, or a daily retry)
  const looking = useTasksStore((s) => openTasksFor(s, paper.id).some((t) => t.kind === "paper.pdf" || t.kind === "paper.pdf.browser")) || fetching
  const needs = paper.noPdf?.needs

  const attach = async (files: ArrayLike<File>) => {
    const file = files[0]
    if (!file) return
    try {
      const pdf = await libraryClient.attachPdf(paper, file)
      updatePaper(paper.id, { pdf, noPdf: undefined })
      toast("PDF attached", { description: file.name })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't attach that file.")
    }
  }

  const fetchPdf = async () => {
    setFetching(true)
    try {
      const pdf = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf })
      toast("PDF found")
    } catch (e) {
      if (e instanceof PublisherNeedsUser) {
        // The card now asks for the check; a system notification only if the user went elsewhere
        updatePaper(paper.id, { noPdf: { ...(paper.noPdf ?? { tried: [], at: Date.now() }), needs: e.needs } })
        if (document.hidden) notifyNeeds(paper, e.needs)
      } else toast.error(e instanceof Error ? e.message : "Could not find a PDF.")
    } finally {
      setFetching(false)
    }
  }

  const proxyMissing = useSettings((s) => !!s.view && !s.view.library.proxy)
  const { dragging, dropProps } = useFileDrop((data) => void attach(data.files))

  if (checking) return <PublisherPage paper={paper} onEnd={() => setChecking(false)} />

  const state: CardState = looking ? "looking" : (needs ?? (paper.noPdf ? "not-found" : "not-yet"))
  const detail = state === "not-found" ? `${triedSentence(paper.noPdf?.tried ?? [])} ${CARD[state].detail}` : CARD[state].detail

  return (
    <div className="flex flex-1 items-center justify-center p-6" {...dropProps}>
      <DropCard
        active={dragging}
        title={
          <>
            {looking && <Spinner />}
            {CARD[state].title}
          </>
        }
        detail={detail}
        actions={
          <>
            {needs && canCheck && !looking ? (
              <Button size="sm" onClick={() => setChecking(true)}>
                {needs === "sign-in" ? "Sign in" : "Check now"}
              </Button>
            ) : (
              <Button size="sm" onClick={fetchPdf} disabled={looking}>
                {paper.noPdf ? "Try again" : "Find PDF"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
          </>
        }
      >
        {/* A publisher's paper may be one sign-in away: say so where the PDF is missing */}
        {state === "not-found" && paper.ids.doi && proxyMissing && (
          <p className="max-w-72 text-sm text-muted-foreground">
            Your library may have it.{" "}
            <button type="button" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => openSettings("proxy")}>
              Set up library proxy
            </button>
          </p>
        )}
      </DropCard>
      <PdfFileInput ref={fileInput} onFiles={(files) => void attach(files)} />
    </div>
  )
}

// Check now: the publisher's page fills the reader's place (the desktop app draws it over the box this
// reserves) under one line saying what it waits for. Through, the reader takes over; Cancel, or
// leaving the paper, ends the run and the card comes back.
function PublisherPage({ paper, onEnd }: { paper: Paper; onEnd: () => void }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
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
        updatePaper(paper.id, { pdf: found.pdf, noPdf: found.noPdf })
        if (found.pdf) toast("PDF found")
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "owlit couldn't open the publisher's page."))
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
      ? task.waiting?.detail ?? "The publisher wants you on its page."
      : "Opening the publisher's page…"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-4 text-sm text-muted-foreground">
        {task?.state !== "waiting_for_you" && <Spinner />}
        <span className="min-w-0 flex-1 truncate">{line}</span>
        <Button variant="ghost" size="sm" onClick={() => task && void cancelTask(task.id)} disabled={!task}>
          Cancel
        </Button>
      </div>
      {/* The publisher's page is drawn over this box by the desktop app */}
      <div ref={box} className="min-h-0 flex-1 bg-background" />
    </div>
  )
}

const openCheck = (s: Parameters<typeof openTasksFor>[0], paperId: string) =>
  openTasksFor(s, paperId).find((t) => t.kind === "paper.pdf.check")

// The user went elsewhere while owlit looked: a system notification, which brings owlit back
function notifyNeeds(paper: Paper, needs: "check" | "sign-in") {
  if (typeof Notification === "undefined") return
  const notification = new Notification(CARD[needs].title, { body: paper.title })
  notification.onclick = () => window.focus()
}

// "Tried arXiv, Unpaywall and the publisher." from acquisition route names
function triedSentence(routes: string[]) {
  const nameOf = (r: string) =>
    r === "arxiv" ? "arXiv" : r.startsWith("publisher") || r.startsWith("browser:") && !r.endsWith(":proxied") ? "the publisher" : r.endsWith(":proxied") ? "the library proxy" : r.startsWith("unpaywall") ? "Unpaywall" : r === "open-access" ? "open-access links" : ""
  const names = [...new Set(routes.map(nameOf))].filter(Boolean)
  if (!names.length) return "owlit knows of no open copy of this paper."
  return `Tried ${joinAnd(names)}.`
}
