import { useEffect, useRef, useState, type ReactNode } from "react"
import type { PaperFigure } from "@owlit/protocol"
import { toast } from "sonner"
import { askOwlitOnRightClick, isPassage } from "@/app/text-menu"
import { ago } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"
import { askAboutPassage } from "../../actions"
import type { Paper } from "../../types"

// Owlit's digest of a paper (digest.md), on the page where the PDF otherwise is: most of the time
// it is all the paper needs, so it reads like any other page, in the reading column. Its figures show
// where the digest puts them, and every page it points at (p. 7) can be glanced at and gone to. A
// selected passage can be asked about, as in the PDF; it can't be highlighted, since a rewrite would
// leave a highlight on words that are gone: highlights belong on the paper.

export function useWritingDigest(paperId: string) {
  return useTasksStore((s) => openTasksFor(s, paperId).some((t) => t.kind === "paper.digest"))
}

export function Digest({ paper, onShowPage }: { paper: Paper; onShowPage: (page: number) => void }) {
  const writing = useWritingDigest(paper.id)
  const [digest, setDigest] = useState<{ paperId: string; text: string | null; figures: PaperFigure[] } | null>(null)

  // Read again whenever the digest may have changed: written, rewritten, or gone
  useEffect(() => {
    if (!paper.hasDigest || writing) return
    let live = true
    Promise.all([rpc.library.digest({ id: paper.id }), rpc.library.figures({ id: paper.id }).catch(() => [])])
      .then(([text, figures]) => live && setDigest({ paperId: paper.id, text, figures }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [paper.id, paper.hasDigest, paper.digestAt, writing])

  // A digest fetched for another paper, or for one that has since lost it, isn't shown
  const text = paper.hasDigest && digest?.paperId === paper.id ? digest.text : null
  if (!text) {
    return (
      <Column paperId={paper.id}>
        <p className="flex items-center gap-2 text-detail text-muted-foreground">
          {writing ? <span className="shimmer">Owlit is reading this paper…</span> : paper.hasDigest && <Spinner />}
        </p>
      </Column>
    )
  }
  return (
    <Column paperId={paper.id}>
      <p className="text-detail text-muted-foreground">
        {writing ? <span className="shimmer">Owlit is reading this paper again…</span> : <>Digest · Owlit{paper.digestAt ? `, ${ago(paper.digestAt, { inSentence: true })}` : ""}</>}
      </p>
      {paper.digestOutdated && !writing && <Outdated paper={paper} />}
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

// The menu's distance from the selection, and its height, as the note's
const MENU_GAP = 8
const MENU_HEIGHT = 30

// The reading column. A selected passage offers "Ask Owlit" above it, as a note's does (under it on the
// first lines, where above would leave the view), and on the right-click menu; not while the mouse is
// still choosing.
function Column({ paperId, children }: { paperId: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState<{ left: number; top: number; below: boolean } | null>(null)
  // What the menu's button runs: set by the effect, which knows the selection
  const askRef = useRef<() => void>(undefined)

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
      setMenu(null)
      window.getSelection()?.removeAllRanges()
      askAboutPassage(paperId, { text: passage.text, inDigest: true })
    }
    askRef.current = ask
    let choosing = false
    const place = () => {
      const passage = choosing ? null : selected()
      if (!passage || !page.current || !scroller.current) return setMenu(null)
      const rects = passage.range.getClientRects()
      const first = rects[0] ?? passage.range.getBoundingClientRect()
      const last = rects[rects.length - 1] ?? first
      const outer = page.current.getBoundingClientRect()
      const left = first.left - outer.left
      if (first.top - MENU_GAP - MENU_HEIGHT >= scroller.current.getBoundingClientRect().top) setMenu({ left, top: first.top - outer.top - MENU_GAP, below: false })
      else setMenu({ left, top: last.bottom - outer.top + MENU_GAP, below: true })
    }
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return
      choosing = true
      setMenu(null)
      document.addEventListener(
        "mouseup",
        () => {
          choosing = false
          // After the release has settled the selection
          setTimeout(place)
        },
        { once: true },
      )
    }
    el.addEventListener("mousedown", down)
    // Keys that change the selection, and a selection cleared elsewhere
    document.addEventListener("selectionchange", place)
    const unregister = askOwlitOnRightClick(el, () => (selected() ? ask : null))
    return () => {
      el.removeEventListener("mousedown", down)
      document.removeEventListener("selectionchange", place)
      unregister()
    }
  }, [paperId])

  return (
    <div ref={scroller} className="h-full overflow-y-auto bg-background">
      <div ref={page} className="relative mx-auto max-w-3xl">
        <article ref={article} className="px-6 pt-6 pb-16">
          {children}
        </article>
        {menu && (
          // The Docs selection menu, outside the article so pressing it doesn't start a new selection
          <div className={cn("selection-menu absolute z-20", !menu.below && "-translate-y-full")} style={{ left: menu.left, top: menu.top }}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => askRef.current?.()}>
              Ask Owlit
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// The digest says it was written another way, or in another language, than digests are now; rewriting it
// is the user's call, offered here where they read it and nowhere else
function Outdated({ paper }: { paper: Paper }) {
  const [asked, setAsked] = useState(false)
  const rewrite = () => {
    setAsked(true)
    void rpc.library.requestDigest({ id: paper.id, rewrite: true }).catch(() => {
      setAsked(false)
      toast.error("Couldn't ask for the digest again.")
    })
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-detail text-muted-foreground">
      {paper.digestOutdated === "language" ? "This digest is in another language than the one set for digests." : "This digest was written the old way."}
      <Button variant="ghost" size="sm" className="-ml-1 h-6 px-1.5 text-detail font-normal text-foreground" disabled={asked} onClick={rewrite}>
        Rewrite
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
  return (
    <span className="my-5 block">
      <button
        type="button"
        onClick={() => onShowPage(figure.page)}
        aria-label={`${figure.label}, page ${figure.page + 1}: go to it in the PDF`}
        className="block w-full overflow-hidden rounded-lg border border-border bg-white outline-none focus-key:ring-2 focus-key:ring-ring/50"
      >
        <img src={figure.url} alt={figure.caption} className="mx-auto max-h-[28rem] w-auto" />
      </button>
      <span className="mt-1.5 block text-detail text-muted-foreground">
        {figure.label} · p. {figure.page + 1}
      </span>
    </span>
  )
}

// Pages seen once this session, by paper and page
const pictures = new Map<string, string>()

// A page the digest points at: a glance at it on hover, the PDF there on click
function PageRef({ paperId, page, onShow, children }: { paperId: string; page: number; onShow: (page: number) => void; children: ReactNode }) {
  const key = `${paperId}:${page}`
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
        {picture ? <img src={picture} alt={`Page ${page + 1}`} className="w-full rounded-md border border-border bg-white" /> : <Spinner className="m-auto my-8" />}
      </PopoverContent>
    </Popover>
  )
}
