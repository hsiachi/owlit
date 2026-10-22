import { t } from "@lingui/core/macro"
import type { Paper } from "@owlit/protocol"
import { useLayoutEffect, useRef, useState } from "react"
import { FoldButton } from "@/components/fold"
import { ReadingRing } from "@/components/marks"
import { Button } from "@/components/ui/button"
import { useExtensionWaits } from "@/features/extension/store"
import { actOnWait, waitWords } from "@/features/extension/waits"
import { citationsSource, citationsText } from "@/features/library/lib/format"
import { stripLatex } from "@/features/library/lib/latex"
import { noPdfTitle, pdfWait, type PdfWait } from "@/features/library/lib/pdf-wait"
import { statusLabel } from "@/features/library/lib/status"
import { libraryClient, useLibraryStore } from "@/features/library/store"
import { toastError } from "@/lib/toast"
import { cn } from "@/lib/utils"

// What the card says of a paper: the Library's record, or the facts a thread's row came with while the
// window hasn't got that record yet
export interface PaperCardFacts {
  authors: string[]
  venue?: string
  year?: number
  abstract?: string
  citations?: Paper["citations"]
}

// A paper opened in place, wherever papers are listed (the Library, a thread's list and table): enough to
// decide whether to read it. The byline (authors; venue · year · citations · the PDF · the reading), the
// abstract in three lines until asked for more, then what the place adds (`thread`, a thread's own words on
// the paper) and the place's own actions (`footer`). The card's first line is the row it opened from, so it
// has no title of its own. It is text, not a control: clicks here select words and never fold or open the
// row (`data-peek-body`, which the rows check).
export function PaperCard({ facts, paper, thread, footer, className }: { facts: PaperCardFacts; paper: Paper | undefined; thread?: React.ReactNode; footer: React.ReactNode; className?: string }) {
  return (
    <div data-peek-body className={className}>
      {/* The card runs a wide column, but its words keep one reading measure (68ch), so the text makes one
          block instead of an authors line running to the card's edge over an abstract that stops short */}
      <div className="max-w-[68ch]">
        <Byline facts={facts} paper={paper} />
        {facts.abstract && <Abstract text={stripLatex(facts.abstract)} />}
        {thread}
      </div>
      <div className="mt-3.5 flex items-center gap-1">{footer}</div>
    </div>
  )
}

// The part a thread adds to the card, under a hairline: "In this thread · <its groups>", then what the
// thread says of the paper
export function PaperCardThread({ groups, children }: { groups: string[]; children: React.ReactNode }) {
  return (
    <section className="mt-3 border-t pt-2.5">
      <p className="text-xs text-muted-foreground">
        {[t({ message: "In this thread", comment: "heading of what a thread says about one of its papers, on the paper's card" }), ...groups].join(" · ")}
      </p>
      {children}
    </section>
  )
}

function Byline({ facts, paper }: { facts: PaperCardFacts; paper: Paper | undefined }) {
  const published = [facts.venue, facts.year].filter(Boolean).join(" · ")
  const citations = facts.citations
  const parts: React.ReactNode[] = []
  if (published) parts.push(published)
  if (citations)
    parts.push(
      <span key="citations" className="tabular-nums" title={citationsSource(citations)}>
        {citationsText(citations.count)}
      </span>,
    )
  // Only the Library's record knows the PDF and the reading
  if (paper) parts.push(paper.pdf ? t({ message: "PDF", comment: "on a paper's card: its PDF is in the Library" }) : <PdfLine key="pdf" paper={paper} />)
  if (paper && paper.status !== "unread")
    parts.push(
      <span key="reading" className="inline-flex items-center gap-1">
        {paper.status === "reading" ? t`You've read some of it` : statusLabel(paper.status)}
        {paper.status === "reading" && <ReadingRing />}
      </span>,
    )
  return (
    <p className="text-detail leading-normal text-muted-foreground">
      {facts.authors.join(", ") || t`Unknown authors`}
      {parts.length > 0 && <br />}
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </p>
  )
}

// A paper without its PDF: where getting it stands, titled as the paper's No PDF card is (noPdfTitle),
// and that card's one thing to do when there is one: the site's sign-in, check or permission where the
// extension waits, or Look again once owlit has stopped looking
function PdfLine({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [looking, setLooking] = useState(false)
  const waits = useExtensionWaits()
  const wait = pdfWait(paper) ?? "finding"
  const siteWait = waits.find((w) => w.host === paper.pdfState?.extension?.host)
  const lookAgain = async () => {
    setLooking(true)
    try {
      const found = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf: found.pdf, pdfState: found.pdfState })
    } catch (e) {
      toastError(e, t`Could not find a PDF.`)
    } finally {
      setLooking(false)
    }
  }
  const action =
    WAITS.has(wait) && siteWait ? (
      <Button variant="text" size="inline" onClick={() => void actOnWait(siteWait)}>
        {waitWords(siteWait).action}
      </Button>
    ) : ENDED.has(wait) ? (
      <Button variant="text" size="inline" disabled={looking} onClick={() => void lookAgain()}>
        {t({ message: "Look again", comment: "button: owlit looks for the paper's PDF again, by its own routes" })}
      </Button>
    ) : null
  return (
    <>
      {looking ? t`Finding a PDF…` : noPdfTitle(paper)}
      {action && !looking && <span className="ml-1.5">{action}</span>}
    </>
  )
}

const WAITS: ReadonlySet<PdfWait> = new Set(["for-sign-in", "for-check", "blocked", "for-permission"])
const ENDED: ReadonlySet<PdfWait> = new Set(["not-found", "no-access", "not-offered", "not-there"])

// The abstract in its first three lines, with Show more only when it runs longer
function Abstract({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const box = useRef<HTMLParagraphElement>(null)
  // Measured while clamped, and again as the card's width changes; before paint, so Show more doesn't flash
  useLayoutEffect(() => {
    const el = box.current
    if (!el || open) return
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, text])
  return (
    <div className="mt-2.5">
      <p ref={box} className={cn("text-sm leading-relaxed whitespace-pre-line", !open && "line-clamp-3")}>
        {text}
      </p>
      {(long || open) && (
        <FoldButton open={open} onClick={() => setOpen(!open)} className="mt-1">
          {open ? t`Show less` : t`Show more`}
        </FoldButton>
      )}
    </div>
  )
}
