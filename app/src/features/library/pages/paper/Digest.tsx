import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { DigestSource, Paper, PaperFigure } from "@owlit/protocol"
import { reportPaperEnd } from "@/app/activity"
import { askOwlitOnRightClick, isPassage } from "@/app/text-menu"
import { ago } from "@/lib/time"
import { fileUrl, rpc } from "@/lib/rpc"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { useSelectionMenu } from "@/components/selection-menu"
import { Spinner } from "@/components/ui/spinner"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { askAboutPassage } from "../../actions"
import { markSeen } from "@/app/seen"
import { digestSourceNotes } from "../../lib/digest-source"
import { askDigest, retryDigest, showingDigest, stopDigest, useDigestFailure, useGettingText, useWritingDigest, waitForDigest } from "../../digests"
import { useLibraryStore } from "../../store"

// Owlit's digest of a paper (digest.md), on the page where the PDF otherwise is: a form of the paper that
// is easier to take in, so it reads like any other page, in the reading column, and reopens where it was
// left. Owlit writes one only when asked, and this is where to ask. Its figures show where the digest
// puts them, and every page it points at (p. 7) can be glanced at and gone to. A selected passage can be
// asked about, as in the PDF; it can't be highlighted, since a rewrite would leave a highlight on words
// that are gone: highlights belong on the paper.

export function Digest({ paper, onShowPage }: { paper: Paper; onShowPage: (page: number) => void }) {
  const writing = useWritingDigest(paper.id)
  const gettingText = useGettingText(paper)
  const failed = useDigestFailure(paper.id)
  const [digest, setDigest] = useState<{ paperId: string; text: string | null; figures: PaperFigure[]; source: DigestSource } | null>(null)

  // Read again whenever the digest may have changed: written, rewritten, or gone
  useEffect(() => {
    if (!paper.hasDigest || writing) return
    let live = true
    Promise.all([rpc.library.digest({ id: paper.id }), rpc.library.figures({ id: paper.id }).catch(() => []), rpc.library.digestSource({ id: paper.id }).catch(() => ({}))])
      .then(([text, figures, source]) => live && setDigest({ paperId: paper.id, text, figures, source }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [paper.id, paper.hasDigest, paper.digestAt, writing])

  // A digest fetched for another paper, or for one that has since lost it, isn't shown
  const text = paper.hasDigest && digest?.paperId === paper.id ? digest.text : null

  // Seeing it being written is waiting for it: the user hears when it is done, wherever they went
  useEffect(() => {
    if (writing) waitForDigest(paper.id)
  }, [paper.id, writing])
  // On screen a moment, the digest has been seen: its mark leaves the paper's row and switch
  const shown = !!text && !writing
  useEffect(() => {
    if (!shown) return
    const hide = showingDigest(paper.id)
    const timer = setTimeout(() => markSeen({ kind: "digest", paper: paper.id }), SEEN_AFTER_MS)
    return () => {
      hide()
      clearTimeout(timer)
    }
  }, [paper.id, shown, paper.digestAt])

  if (!text) {
    return (
      <Column paperId={paper.id}>
        {writing ? (
          <>
            <p className="flex items-center gap-1.5 text-detail text-muted-foreground">
              <span className="shimmer">{gettingText ? t`Owlit is getting the text…` : t`Owlit is reading this paper…`}</span>
              {!gettingText && <StopDigest paperId={paper.id} />}
            </p>
            <p className="mt-1 text-detail text-muted-foreground">{t`You can keep reading. Owlit will let you know when it's ready.`}</p>
          </>
        ) : failed ? (
          <Stopped paper={paper} why={failed} />
        ) : paper.hasDigest ? (
          <Spinner />
        ) : (
          <Offer paper={paper} />
        )}
      </Column>
    )
  }
  const when = paper.digestAt ? ago(paper.digestAt, { inSentence: true }) : null
  // What it was written from, when that limits it
  const from = digest ? digestSourceNotes(digest.source, paper.pdf?.pages) : []
  return (
    <Column paperId={paper.id} remembers>
      {writing ? (
        <p className="flex items-center gap-1.5 text-detail text-muted-foreground">
          <span className="shimmer">{t`Owlit is reading this paper again…`}</span>
          <StopDigest paperId={paper.id} />
        </p>
      ) : (
        <p className="text-detail text-muted-foreground">{when ? t`Digest · Owlit, ${when}` : t`Digest · Owlit`}</p>
      )}
      {from.length > 0 && <p className="text-detail text-muted-foreground">{from.join(" · ")}</p>}
      {failed && !writing ? <Stopped paper={paper} why={failed} /> : paper.digestOutdated && !writing && <Outdated paper={paper} />}
      <Markdown
        text={withoutTitle(text)}
        prepare={linkPages}
        className="mt-5 text-body"
        components={{
          img: ({ src }) => {
            const figure = digest?.figures.find((f) => f.id === src)
            return figure ? <Figure figure={figure} onShowPage={onShowPage} /> : null
          },
          a: ({ href, children }) => {
            const page = pageOf(href)
            if (page !== undefined) {
              return (
                <PageRef paperId={paper.id} page={page} onShow={onShowPage}>
                  {children}
                </PageRef>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      />
    </Column>
  )
}

// The reading column. A selected passage offers "Ask Owlit" above it, as a note's does (under it on the
// first lines, where above would leave the view), and on the right-click menu; not while the mouse is
// still choosing. With a digest in it (remembers), it reopens where the digest was left and keeps track
// of where that is, as the PDF reader does (reader/position.ts).
function Column({ paperId, remembers, children }: { paperId: string; remembers?: boolean; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el || !remembers) return
    el.scrollTop = useLibraryStore.getState().papers[paperId]?.digestPosition?.y ?? 0
    let timer: ReturnType<typeof setTimeout> | undefined
    // Its end in view is part of reading it to the end (core counts it with the time on the digest)
    let ended = false
    const atEnd = () => {
      if (ended || el.scrollTop + el.clientHeight < el.scrollHeight - END_SLACK_PX) return
      ended = true
      reportPaperEnd(paperId, "digest")
    }
    const onScroll = () => {
      atEnd()
      clearTimeout(timer)
      timer = setTimeout(() => useLibraryStore.getState().setDigestPosition(paperId, { y: Math.round(el.scrollTop) }), POSITION_REST_MS)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    // A digest short enough to fit is at its end as it opens
    const fits = setTimeout(atEnd, POSITION_REST_MS)
    return () => {
      el.removeEventListener("scroll", onScroll)
      clearTimeout(timer)
      clearTimeout(fits)
    }
  }, [paperId, remembers])
  const page = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  // What the menu's button runs: set by the effect, which knows the selection
  const askRef = useRef<() => void>(undefined)
  const { menu, control: selectionMenu } = useSelectionMenu(() => askRef.current?.())

  useEffect(() => {
    const el = article.current
    if (!el) return
    const selected = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return null
      const text = sel.toString().trim()
      return isPassage(text) ? { text, range } : null
    }
    const ask = () => {
      const passage = selected()
      if (!passage) return
      selectionMenu.hide()
      window.getSelection()?.removeAllRanges()
      askAboutPassage(paperId, { text: passage.text, inDigest: true })
    }
    askRef.current = ask
    const place = () => {
      const passage = mouse.choosing() ? null : selected()
      if (!passage || !page.current || !scroller.current) return selectionMenu.hide()
      const rects = passage.range.getClientRects()
      const first = rects[0] ?? passage.range.getBoundingClientRect()
      const last = rects[rects.length - 1] ?? first
      selectionMenu.show(page.current.getBoundingClientRect(), first, () => last.bottom, scroller.current.getBoundingClientRect().top)
    }
    const mouse = selectionMenu.watch(el, place, { primary: true })
    // Keys that change the selection, and a selection cleared elsewhere
    document.addEventListener("selectionchange", place)
    const unregister = askOwlitOnRightClick(el, () => (selected() ? ask : null))
    return () => {
      mouse.stop()
      document.removeEventListener("selectionchange", place)
      unregister()
    }
  }, [paperId, selectionMenu])

  return (
    <div ref={scroller} className="h-full overflow-y-auto bg-background">
      <div ref={page} className="relative mx-auto max-w-3xl">
        <article ref={article} className="px-6 pt-6 pb-16">
          {children}
        </article>
        {/* Outside the article, so pressing it doesn't start a new selection */}
        {menu}
      </div>
    </div>
  )
}

// How long a digest is on screen before it counts as seen
const SEEN_AFTER_MS = 1000
// A scroll that has stopped this long is where the digest was left
const POSITION_REST_MS = 400
// The column's bottom padding and a line's leeway: the last lines are in view this close to the bottom
const END_SLACK_PX = 96

// No digest yet: Owlit writes one when asked, and the ask is here, where the digest will be
function Offer({ paper }: { paper: Paper }) {
  const ask = () => {
    // Asked for, the digest that comes is news
    markSeen({ kind: "digest", paper: paper.id })
    waitForDigest(paper.id)
    void askDigest(paper, false)
  }
  return (
    <>
      <p className="text-detail text-muted-foreground">{t`No digest yet. Owlit writes one when you ask.`}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={ask}>
        {t`Write a digest`}
      </Button>
    </>
  )
}

// Stops the chat writing the digest
function StopDigest({ paperId }: { paperId: string }) {
  return (
    <Button variant="text" size="inline" onClick={() => stopDigest(paperId)}>
      {t({ message: "Stop", comment: "stop Owlit writing a paper's digest" })}
    </Button>
  )
}

// The last try broke: the sentence its reply ended with (kept by core, so after a restart too), with
// Retry, a new turn in the same chat (a new chat when the language changed since). Above the old digest
// when it was a rewrite.
function Stopped({ paper, why }: { paper: Paper; why: string }) {
  return (
    <AskAgain
      sentence={why}
      label={t`Retry`}
      ask={() => retryDigest(paper)}
    />
  )
}

// The digest says it was written another way, or in another language, than digests are now; rewriting it
// is the user's call, offered here where they read it and nowhere else
function Outdated({ paper }: { paper: Paper }) {
  return (
    <AskAgain
      sentence={paper.digestOutdated === "language" ? t`This digest is in another language than the one set for digests.` : t`This digest was written the old way.`}
      label={t({ message: "Rewrite", comment: "button: write the digest again" })}
      ask={() => askDigest(paper, true)}
    />
  )
}

// A sentence about the digest and the button that asks for it again, held down once pressed unless the
// asking failed
function AskAgain({ sentence, label, ask }: { sentence: string; label: string; ask: () => Promise<boolean> }) {
  const [asked, setAsked] = useState(false)
  const run = () => {
    setAsked(true)
    void ask().then((ok) => ok || setAsked(false))
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-detail text-muted-foreground">
      {sentence}
      <Button variant="ghost" size="sm" className="-ml-1 h-6 px-1.5 text-detail font-normal text-foreground" disabled={asked} onClick={run}>
        {label}
      </Button>
    </p>
  )
}

// The header shows the title already; the digest starts under its own
const withoutTitle = (text: string) => text.replace(/^\s*# [^\n]*\n+/, "")

// "p. 7", "pp. 3–4" become links to their (first) page, outside code and links. Pages are the PDF's,
// as the text's <!-- page N --> marks number them.
function linkPages(text: string) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\))/)
    .map((part, i) => (i % 2 ? part : part.replace(/(?<![\w[])(pp?\.\s?)(\d{1,4})(\s?[–-]\s?\d{1,4})?(?![\d\]])/g, (whole, _p, first) => `[${whole}](#page-${first})`)))
    .join("")
}

// 0-based page of a #page-N link
function pageOf(href: string | undefined) {
  const m = href && /^#page-(\d+)$/.exec(href)
  return m ? Number(m[1]) - 1 : undefined
}

// A figure where the digest shows it: the picture on white (as the page is), its label and page under it.
// Inside a paragraph, so spans, not a <figure>.
function Figure({ figure, onShowPage }: { figure: PaperFigure; onShowPage: (page: number) => void }) {
  const label = figure.label
  const page = figure.page + 1
  return (
    <span className="my-5 block">
      <button
        type="button"
        onClick={() => onShowPage(figure.page)}
        aria-label={t`${label}, page ${page}: go to it in the PDF`}
        className="block w-full overflow-hidden rounded-lg border border-border bg-white outline-none focus-key:ring-2 focus-key:ring-ring/50"
      >
        <img src={fileUrl(figure.url)} alt={figure.caption} className="mx-auto max-h-[28rem] w-auto" />
      </button>
      <span className="mt-1.5 block text-detail text-muted-foreground">
        {t`${label} · p. ${page}`}
      </span>
    </span>
  )
}

// Pages seen once this session, by paper and page
const pictures = new Map<string, string>()

// A page the digest points at: a glance at it on hover, the PDF there on click
function PageRef({ paperId, page, onShow, children }: { paperId: string; page: number; onShow: (page: number) => void; children: ReactNode }) {
  const key = `${paperId}:${page}`
  const number = page + 1
  const [open, setOpen] = useState(false)
  const [picture, setPicture] = useState(pictures.get(key))
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOpen(true)
      if (pictures.has(key)) return
      void rpc.library
        .pagePicture({ id: paperId, page })
        .then((p) => {
          const url = `data:${p.mimeType};base64,${p.data}`
          pictures.set(key, url)
          setPicture(url)
        })
        .catch(() => setOpen(false))
    }, 350)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 150)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={() => {
            setOpen(false)
            onShow(page)
          }}
          className="rounded-sm underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-key:ring-2 focus-key:ring-ring/50"
        >
          {children}
        </button>
      </PopoverAnchor>
      <PopoverContent side="top" className="w-80 p-1.5" onMouseEnter={show} onMouseLeave={hide} onOpenAutoFocus={(e) => e.preventDefault()}>
        {picture ? <img src={picture} alt={t`Page ${number}`} className="w-full rounded-md border border-border bg-white" /> : <Spinner className="m-auto my-8" />}
      </PopoverContent>
    </Popover>
  )
}
