import { t } from "@lingui/core/macro"
import { SearchIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { COLLECT } from "./content"
import { useScript } from "./engine"
import { Cursor, Layers } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

interface CollectState {
  // The question as typed so far, then the collection it became
  typed: string
  gathered: boolean
  rows: number
  memo: number
  // The person rewrites one of Owlit's answers, which then stays theirs
  editing: boolean
  rewritten: string | null
  corrected: boolean
}

const FIRST: CollectState = { typed: "", gathered: false, rows: 0, memo: 0, editing: false, rewritten: null, corrected: false }

// Collect: a question typed on the Collections page becomes papers, each with what it says about the
// question (with its page when it came from the full text) and the paper's name, and Owlit's short reading
// of them, which names the papers the same way; one answer is corrected by hand
export function CollectDemo() {
  useDemoPlace("collections")
  const { layers, cursor, root, reg } = useScript<CollectState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, typed: COLLECT.question, gathered: true, rows: COLLECT.rows.length, memo: COLLECT.memo.length, rewritten: COLLECT.corrected, corrected: true }),
    script: async (c) => {
      await c.sleep(400)
      await c.type("typed", COLLECT.question, 34)
      await c.sleep(600)
      c.set({ gathered: true })
      for (let i = 1; i <= COLLECT.rows.length; i++) {
        await c.sleep(650)
        c.set({ rows: i })
      }
      for (let i = 1; i <= COLLECT.memo.length; i++) {
        await c.sleep(700)
        c.set({ memo: i })
      }
      await c.sleep(900)
      await c.moveTo(470, 390, 10)
      await c.sleep(30)
      await c.moveToEl("answer", 0.4, 0.6, 800)
      await c.click()
      c.hideCursor()
      c.set({ editing: true, rewritten: "" })
      await c.sleep(300)
      await c.type("rewritten", COLLECT.corrected, 28)
      await c.sleep(500)
      c.set({ editing: false, corrected: true })
      await c.sleep(3000)
    },
  })

  return (
    <div ref={root} className="absolute inset-0">
      <Layers layers={layers}>{(st) => <CollectionView st={st} reg={reg} />}</Layers>
      <Cursor {...cursor} />
    </div>
  )
}

type Reg = (name: string) => (el: HTMLElement | null) => () => void

function CollectionView({ st, reg }: { st: CollectState; reg: Reg }) {
  return (
    <div className={s.kn}>
      {!st.gathered ? (
        <>
          <div className={s.h}>{t`Collections`}</div>
          <div className={s.collectField}>
            <SearchIcon />
            <span className={cn(!st.typed && s.mut)}>{st.typed || t`Collect papers on…`}</span>
          </div>
        </>
      ) : (
        <div className={s.fadein}>
          <div className={s.h}>{COLLECT.title}</div>
          <ul className={s.memo}>
            {COLLECT.memo.slice(0, st.memo).map((line, i) => (
              <li key={i} className={s.fadein}>
                {line}
              </li>
            ))}
          </ul>
          <div className={s.crows}>
            {COLLECT.rows.slice(0, st.rows).map((row, i) => {
              const mine = i === 1 && st.rewritten != null
              return (
                <div key={i} className={cn(s.crow, s.fadein)}>
                  <span ref={i === 1 ? reg("answer") : undefined} className={cn(i === 1 && st.editing && s.editBox)}>
                    {mine ? st.rewritten : row.text}
                  </span>{" "}
                  <span className={s.cite}>{row.cite}</span>
                  {mine && st.corrected && <span className={s.cite}> · {t({ message: "you edited", comment: "after a sentence of Owlit's that the user rewrote" })}</span>}
                  {row.page > 0 && <span className={s.pageNo}>{t({ message: `p. ${row.page}`, comment: "a page of a paper" })}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
