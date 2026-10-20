import { t } from "@lingui/core/macro"
import { SearchIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { COLLECT } from "./content"
import { useScript } from "./engine"
import { Cursor, Layers } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

interface CollectState {
  // The question as typed so far, then the thread it became
  typed: string
  gathered: boolean
  rows: number
  report: number
  // The second question, asked under the thread, and the paper it added
  asking: string | null
  added: boolean
}

const FIRST: CollectState = { typed: "", gathered: false, rows: 0, report: 0, asking: null, added: false }

// Collect: a question asked becomes a thread: papers, each with what it is and how it bears on the
// question (with its page when it came from the full text), and Owlit's report on them above. A second
// question adds a paper and the report changes with it: the thread changes by asking, not by hand.
export function CollectDemo() {
  useDemoPlace("threads")
  const { layers, cursor, root, reg } = useScript<CollectState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, typed: COLLECT.question, gathered: true, rows: COLLECT.rows.length, report: COLLECT.report.length, asking: COLLECT.followUp, added: true }),
    script: async (c) => {
      await c.sleep(400)
      await c.type("typed", COLLECT.question, 34)
      await c.sleep(600)
      c.set({ gathered: true })
      for (let i = 1; i <= COLLECT.rows.length; i++) {
        await c.sleep(650)
        c.set({ rows: i })
      }
      for (let i = 1; i <= COLLECT.report.length; i++) {
        await c.sleep(700)
        c.set({ report: i })
      }
      await c.sleep(900)
      await c.moveTo(470, 390, 10)
      await c.sleep(30)
      await c.moveToEl("ask", 0.3, 0.5, 800)
      await c.click()
      c.hideCursor()
      c.set({ asking: "" })
      await c.sleep(300)
      await c.type("asking", COLLECT.followUp, 28)
      await c.sleep(700)
      c.set({ added: true })
      await c.sleep(3000)
    },
  })

  return (
    <div ref={root} className="absolute inset-0">
      <Layers layers={layers}>{(st) => <ThreadView st={st} reg={reg} />}</Layers>
      <Cursor {...cursor} />
    </div>
  )
}

type Reg = (name: string) => (el: HTMLElement | null) => () => void

function ThreadView({ st, reg }: { st: CollectState; reg: Reg }) {
  const report = COLLECT.report.slice(0, st.report).map((line, i) => (st.added && i === 1 ? COLLECT.reportAfter : line))
  const rows = [...COLLECT.rows.slice(0, st.rows), ...(st.added ? [COLLECT.added] : [])]
  return (
    <div className={s.kn}>
      {!st.gathered ? (
        <>
          <div className={s.h}>{t`Chat`}</div>
          <div className={s.collectField}>
            <SearchIcon />
            <span className={cn(!st.typed && s.mut)}>{st.typed || t`Ask Owlit…`}</span>
          </div>
        </>
      ) : (
        <div className={s.fadein}>
          <div className={s.h}>{COLLECT.title}</div>
          <p className={s.report}>
            {report.map((line, i) => (
              <span key={`${i}-${line}`} className={s.fadein}>
                {i > 0 && " "}
                {line}
              </span>
            ))}
          </p>
          <div className={s.crows}>
            {rows.map((row) => (
              <div key={row.cite} className={cn(s.crow, s.fadein)}>
                <span className={s.cite}>{row.is} · </span>
                {row.text} <span className={s.cite}>{row.cite}</span>
                {row.page > 0 && <span className={s.pageNo}>{t({ message: `p. ${row.page}`, comment: "a page of a paper" })}</span>}
              </div>
            ))}
          </div>
          {st.report === COLLECT.report.length && (
            <div ref={reg("ask")} className={cn(s.collectField, s.fadein)}>
              <span className={cn(st.asking == null && s.mut)}>{st.asking ?? t`Ask Owlit to change this thread…`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
