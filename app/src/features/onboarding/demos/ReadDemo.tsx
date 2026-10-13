import { t } from "@lingui/core/macro"
import { CopyIcon, MessageCircleIcon, SearchIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import { OwlitMark } from "@/components/owlit-mark"
import { LIBRARY_PAPERS, READ } from "./content"
import { useScript, useTravel } from "./engine"
import { Cursor, Layers, PaperRow } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

interface ReadState {
  view: "library" | "paper"
  // The Library: a PDF dropped in, its row arriving and getting its title
  dropped: boolean
  ring: boolean
  fileGone: boolean
  rowOpen: boolean
  rowNamed: boolean
  rowSelected: boolean
  // The paper: a sentence selected and highlighted, then the digest
  selecting: boolean
  highlighted: boolean
  toolbar: { x: number; y: number } | null
  toolbarOn: boolean
  bump: boolean
  digestDot: boolean
  digest: boolean
  // How many of the digest's parts have come in
  parts: number
}

const FIRST: ReadState = {
  view: "library",
  dropped: false,
  ring: false,
  fileGone: false,
  rowOpen: false,
  rowNamed: false,
  rowSelected: false,
  selecting: false,
  highlighted: false,
  toolbar: null,
  toolbarOn: false,
  bump: false,
  digestDot: false,
  digest: false,
  parts: 0,
}
const DIGEST_PARTS = 9

// Read: a PDF drops into the Library and opens; a sentence is selected and turns yellow; Owlit's dot comes
// up on the header's Digest / PDF switch, and the digest opens in place of the PDF, as the app does it
export function ReadDemo() {
  useDemoPlace("library")
  const { layers, cursor, root, reg } = useScript<ReadState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, view: "paper", highlighted: true, digest: true, parts: DIGEST_PARTS }),
    script: async (c) => {
      await c.sleep(700)
      c.set({ dropped: true, ring: true })
      await c.sleep(950)
      c.set({ fileGone: true, ring: false, rowOpen: true })
      await c.sleep(1300)
      c.set({ rowNamed: true })
      await c.sleep(700)
      await c.moveTo(520, 300, 10)
      await c.sleep(50)
      await c.moveToEl("newRow", 0.3, 0.55, 800)
      c.set({ rowSelected: true })
      await c.click()
      c.hideCursor()
      c.scene({ ...FIRST, view: "paper" })
      await c.sleep(950)
      const lines = c.lines("sentence")
      const first = lines[0]
      const last = lines[lines.length - 1]
      if (first && last) {
        await c.moveTo(first.x, first.y + 4, 800)
        c.set({ selecting: true })
        await c.moveTo(last.x + last.w, last.y + 4, 1000)
        c.set({ toolbar: { x: Math.min(290, last.x + last.w - 140), y: first.y - 30 } })
        await c.sleep(30)
        c.set({ toolbarOn: true })
        await c.sleep(500)
        await c.moveToEl("yellow", 0.5, 0.5, 500)
        await c.click()
      }
      c.set({ highlighted: true, toolbarOn: false, bump: true })
      c.later(220, () => c.set({ bump: false }))
      c.hideCursor()
      await c.sleep(1000)
      // Owlit finished the digest while you read: its dot on the switch
      c.set({ digestDot: true })
      await c.sleep(900)
      await c.moveToEl("digestSwitch", 0.4, 0.6, 800)
      await c.click()
      c.hideCursor()
      c.set({ digestDot: false, digest: true })
      for (let i = 1; i <= DIGEST_PARTS; i++) {
        await c.sleep(230)
        c.set({ parts: i })
      }
      await c.sleep(3200)
    },
  })

  return (
    <div ref={root} className="absolute inset-0">
      <Layers layers={layers}>{(st) => (st.view === "library" ? <LibraryView st={st} reg={reg} /> : <PaperView st={st} reg={reg} />)}</Layers>
      <Cursor {...cursor} />
    </div>
  )
}

type Reg = (name: string) => (el: HTMLElement | null) => () => void

function LibraryView({ st, reg }: { st: ReadState; reg: Reg }) {
  return (
    <>
      <div className={s.lib}>
        <div className={s.h}>{t`Library`}</div>
        <div className={s.find}>
          <SearchIcon />
          <span>{t`Search, or paste a DOI, arXiv id or link to add`}</span>
        </div>
        <div className={s.grow} data-open={st.rowOpen || undefined}>
          <div>
            <div ref={reg("newRow")} className={s.row} data-sel={st.rowSelected || undefined}>
              <KIND_ICON.paper />
              <span className={cn(s.t, !st.rowNamed && "shimmer")}>{st.rowNamed ? READ.title : READ.file}</span>
              <span className={s.m}>{st.rowNamed ? READ.meta : ""}</span>
            </div>
          </div>
        </div>
        {LIBRARY_PAPERS.map((p) => (
          <PaperRow key={p.title} {...p} />
        ))}
      </div>
      <div className={s.dropRing} data-on={st.ring || undefined}>
        {t`Drop PDFs to add them to your Library`}
      </div>
      {/* i18n-ignore: the file's type, as its icon shows it */}
      <div className={s.pdfFile} data-dropped={st.dropped || undefined} data-gone={st.fileGone || undefined}>
        PDF
      </div>
    </>
  )
}

function PaperView({ st, reg }: { st: ReadState; reg: Reg }) {
  const view = st.digest ? 0 : 1
  const { box: segBox, mark: segThumb } = useTravel<HTMLSpanElement, HTMLSpanElement>(view)
  // The details panel opens on Highlights, the tab this scene adds to
  const { box: tabsBox, mark: tabsLine } = useTravel<HTMLDivElement, HTMLElement>(1)
  const d = READ.digest
  // Named as the app's own messages name them, so the words are the ones already translated
  const { position, total } = READ
  const page = 1
  const when = t`just now`
  const part = (i: number) => (st.parts > i ? { "data-in": true } : {})
  return (
    <>
      <div className={s.phead}>
        <span className={s.mut}>{t`Library`}</span>
        <span className={s.mut}>›</span>
        <span>{READ.short}</span>
        <span className={s.sp} />
        <span ref={segBox} className={s.mseg}>
          <span ref={segThumb} className={cn(s.th, "shadow-xs")} />
          <span ref={reg("digestSwitch")} data-item data-on={view === 0 || undefined}>
            {t({ message: "Digest", comment: "a view of the paper page: Owlit's digest of the paper" })}
            <i className={s.sdot} data-on={st.digestDot || undefined} />
          </span>
          {/* i18n-ignore: the file's type */}
          <span data-item data-on={view === 1 || undefined}>
            PDF
          </span>
        </span>
        <span className={s.mut}>{t`${position} of ${total}`}</span>
      </div>
      <div className={s.reader} data-head>
        <div className={s.pagewrap}>
          <div className={s.page}>
            <h4>{READ.title}</h4>
            <div className={s.au}>{READ.authors}</div>
            <div className={s.sec}>{READ.section}</div>
            <p>
              {READ.before}
              <span ref={reg("sentence")} className={s.selTarget} data-selecting={st.selecting || undefined} data-hl={st.highlighted || undefined}>
                {READ.highlighted}
              </span>
              {READ.after}
            </p>
          </div>
          <div className={s.digestView} data-on={st.digest || undefined}>
            <div className={s.dmeta} {...part(0)}>
              {t`Digest · Owlit, ${when}`}
            </div>
            <div className={s.dh} {...part(1)}>
              {d.question}
            </div>
            <p {...part(2)}>{d.questionText}</p>
            <div className={s.dh} {...part(3)}>
              {d.how}
            </div>
            <p {...part(4)}>
              {d.howRuns.map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>))}
              <span className={s.plink}>{d.howPage}</span>.
            </p>
            <div className={s.dfig} {...part(5)}>
              <span>{d.figure[0]}</span>
              <i />
              <span>{d.figure[1]}</span>
              <i />
              <span>{d.figure[2]}</span>
            </div>
            <div className={s.dcap} {...part(6)}>
              {d.figureCaption}
            </div>
            <div className={s.dh} {...part(7)}>
              {d.found}
            </div>
            <p {...part(8)}>
              {d.foundText}
              <span className={s.plink}>{d.foundPage}</span>.
            </p>
          </div>
        </div>
        <div className={s.side}>
          <div className={s.pt}>{READ.sideTitle}</div>
          <div className={s.mut} style={{ fontSize: 10.5, marginTop: 4 }}>
            {READ.meta}
          </div>
          <div ref={tabsBox} className={s.tabs}>
            <span data-item>{t`Notes`}</span>
            <span data-item data-on>
              {t`Highlights`}{" "}
              <b className={s.count} data-bump={st.bump || undefined}>
                {st.highlighted ? 1 : 0}
              </b>
            </span>
            <span data-item>{t`Knowledge`}</span>
            <span data-item>{t`About`}</span>
            <i ref={tabsLine} className={s.ul} />
          </div>
          <div className={s.sideBody}>
            {st.highlighted ? (
              <>
                <div className="text-foreground">{READ.quote}</div>
                <div style={{ marginTop: 3 }}>{t`Page ${page}`}</div>
              </>
            ) : (
              t`Select text in the PDF to highlight it.`
            )}
          </div>
        </div>
      </div>
      {st.toolbar && (
        <div className={cn(s.hlBar, s.pop, "menu-surface")} data-on={st.toolbarOn || undefined} style={{ left: st.toolbar.x, top: st.toolbar.y }}>
          <i ref={reg("yellow")} style={{ background: "var(--highlight-yellow)" }} />
          <i style={{ background: "var(--highlight-green)" }} />
          <i style={{ background: "var(--highlight-blue)" }} />
          <i style={{ background: "var(--highlight-pink)" }} />
          <span className={s.bsep} />
          <CopyIcon />
          <MessageCircleIcon />
          <OwlitMark />
        </div>
      )}
    </>
  )
}
