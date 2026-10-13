import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { PaperFigure } from "@owlit/protocol"
import { toast } from "sonner"
import { ago } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"
import type { Paper } from "../../types"

// Owlit's reading note on a paper (digest.md), on the page where the PDF otherwise is: most of the time
// it is all the paper needs, so it reads like any other page, in the reading column. Its figures show
// where the note puts them, and every page it points at (p. 7) can be glanced at and gone to.

export function useWritingNote(paperId: string) {
  return useTasksStore((s) => openTasksFor(s, paperId).some((task) => task.kind === "paper.digest"))
}

export function ReadingNote({ paper, onShowPage }: { paper: Paper; onShowPage: (page: number) => void }) {
  const writing = useWritingNote(paper.id)
  const [note, setNote] = useState<{ paperId: string; text: string | null; figures: PaperFigure[] } | null>(null)

  // Read again whenever the note may have changed: written, rewritten, or gone
  useEffect(() => {
    if (!paper.hasDigest || writing) return
    let live = true
    Promise.all([rpc.library.digest({ id: paper.id }), rpc.library.figures({ id: paper.id }).catch(() => [])])
      .then(([text, figures]) => live && setNote({ paperId: paper.id, text, figures }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [paper.id, paper.hasDigest, paper.digestAt, writing])

  // A note fetched for another paper, or for one that has since lost it, isn't shown
  const text = paper.hasDigest && note?.paperId === paper.id ? note.text : null
  if (!text) {
    return (
      <Column>
        <p className="flex items-center gap-2 text-detail text-muted-foreground">
          {writing ? <span className="shimmer">{t`Owlit is reading this paper…`}</span> : paper.hasDigest && <Spinner />}
        </p>
      </Column>
    )
  }
  const when = paper.digestAt ? ago(paper.digestAt, { inSentence: true }) : null
  return (
    <Column>
      <p className="text-detail text-muted-foreground">
        {writing ? <span className="shimmer">{t`Owlit is reading this paper again…`}</span> : when ? t`Reading note · Owlit, ${when}` : t`Reading note · Owlit`}
      </p>
      {paper.digestOutdated && !writing && <Outdated paper={paper} />}
      <Markdown
        text={withoutTitle(text)}
        prepare={linkPages}
        className="mt-5 text-body"
        components={{
          img: ({ src }) => {
            const figure = note?.figures.find((f) => f.id === src)
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

function Column({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <article className="mx-auto max-w-3xl px-6 pt-6 pb-16">{children}</article>
    </div>
  )
}

// The note says it was written another way, or in another language, than notes are now; rewriting it is
// the user's call, offered here where they read it and nowhere else
function Outdated({ paper }: { paper: Paper }) {
  const [asked, setAsked] = useState(false)
  const rewrite = () => {
    setAsked(true)
    void rpc.library.requestDigest({ id: paper.id, rewrite: true }).catch(() => {
      setAsked(false)
      toast.error(t`Couldn't ask for the note again.`)
    })
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-detail text-muted-foreground">
      {paper.digestOutdated === "language" ? t`This note is in another language than your reading notes now.` : t`This note was written the old way.`}
      <Button variant="ghost" size="sm" className="-ml-1 h-6 px-1.5 text-detail font-normal text-foreground" disabled={asked} onClick={rewrite}>
        {t({ message: "Rewrite", comment: "button: write the reading note again" })}
      </Button>
    </p>
  )
}

// The panel shows the title already; the note starts under its own
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

// A figure where the note shows it: the picture on white (as the page is), its label and page under it.
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
        <img src={figure.url} alt={figure.caption} className="mx-auto max-h-[28rem] w-auto" />
      </button>
      <span className="mt-1.5 block text-detail text-muted-foreground">
        {t`${label} · p. ${page}`}
      </span>
    </span>
  )
}

// Pages seen once this session, by paper and page
const pictures = new Map<string, string>()

// A page the note points at: a glance at it on hover, the PDF there on click
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
