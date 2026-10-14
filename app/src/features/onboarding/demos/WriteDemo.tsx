import { t } from "@lingui/core/macro"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import { OwlitMark } from "@/components/owlit-mark"
import { WRITE } from "./content"
import { useScript } from "./engine"
import { Cursor, Layers } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

interface WriteState {
  typed: string
  // "@rag" while the mention popup is open, then the citation it became
  mention: boolean
  cited: boolean
  pop: { x: number; y: number } | null
  popOn: boolean
  caret: boolean
  // The new sentence selected, its menu, Ask Owlit pressed
  selected: boolean
  menu: { x: number; y: number } | null
  menuOn: boolean
  editPressed: boolean
  // Owlit's proposed rewrite: the old words struck, the new ones typed in, then applied
  struck: boolean
  rewrite: string | null
  bar: boolean
  applied: boolean
}

const FIRST: WriteState = {
  typed: "",
  mention: false,
  cited: false,
  pop: null,
  popOn: false,
  caret: true,
  selected: false,
  menu: null,
  menuOn: false,
  editPressed: false,
  struck: false,
  rewrite: null,
  bar: false,
  applied: false,
}

// Write: a sentence typed, a paper cited with @, the sentence handed to Owlit to edit, its rewrite applied
export function WriteDemo() {
  useDemoPlace("docs")
  const { layers, cursor, root, reg } = useScript<WriteState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, typed: WRITE.typed, cited: true, caret: false, struck: true, rewrite: WRITE.rewritten, applied: true }),
    script: async (c) => {
      await c.sleep(600)
      await c.type("typed", WRITE.typed, 34)
      c.set({ mention: true })
      await c.sleep(250)
      const caret = c.at("caret")
      if (caret) c.set({ pop: { x: Math.min(330, caret.x - 24), y: caret.y + 22 } })
      await c.sleep(20)
      c.set({ popOn: true })
      await c.sleep(1400)
      c.set({ popOn: false, mention: false, cited: true })
      c.later(150, () => c.set({ pop: null }))
      await c.sleep(1000)
      // Select the new sentence and ask Owlit to edit it
      const old = c.at("old")
      c.set({ caret: false, selected: true, menu: old ? { x: old.x + 10, y: old.y - 34 } : null })
      await c.sleep(20)
      c.set({ menuOn: true })
      await c.moveTo(460, 390, 10)
      await c.sleep(30)
      await c.moveToEl("edit", 0.5, 0.55, 700)
      c.set({ editPressed: true })
      await c.click()
      c.set({ menuOn: false, selected: false })
      c.hideCursor()
      await c.sleep(600)
      c.set({ struck: true, rewrite: "" })
      await c.type("rewrite", WRITE.rewritten, 22)
      c.set({ bar: true })
      await c.sleep(900)
      await c.moveToEl("apply", 0.5, 0.55, 800)
      await c.click()
      c.set({ bar: false, applied: true })
      c.hideCursor()
      await c.sleep(3000)
    },
  })

  return (
    <div ref={root} className="absolute inset-0">
      <Layers layers={layers}>{(st) => <DocView st={st} reg={reg} />}</Layers>
      <Cursor {...cursor} />
    </div>
  )
}

type Reg = (name: string) => (el: HTMLElement | null) => () => void

function DocView({ st, reg }: { st: WriteState; reg: Reg }) {
  const PaperIcon = KIND_ICON.paper
  const proposing = st.rewrite != null && !st.applied
  return (
    <>
      <div className={s.doc}>
        <div className={s.crumb}>{WRITE.crumb}</div>
        <div className={s.dt}>{WRITE.title}</div>
        <div className={cn(s.para, s.ruled)} data-rule={proposing || undefined}>
          {WRITE.lead}
          <span className={s.cite}>{WRITE.leadCite}</span>.{" "}
          {!st.applied && (
            <span ref={reg("old")} className={cn(s.old, st.selected && s.txtsel)} data-struck={st.struck || undefined}>
              {st.typed}
            </span>
          )}
          {st.rewrite != null && (
            <span className={s.ins} data-applied={st.applied || undefined}>
              {st.rewrite}
            </span>
          )}
          {st.mention && <span className={s.cite}>{WRITE.mention}</span>}
          {st.cited && (
            <>
              <span className={s.citeIn}>{WRITE.cite}</span>.
            </>
          )}
          {st.caret && <span ref={reg("caret")} className={s.caret} />}
          {/* The line under a proposed edit that answers it, as a doc draws it */}
          <div className={cn(s.suggestBar, s.pop)} data-on={st.bar || undefined}>
            <span>{t`Suggested by Owlit`}</span>
            <span className={s.b}>{t({ message: "Discard", comment: "verb: discard an edit Owlit suggested" })}</span>
            <span ref={reg("apply")} className={cn(s.b, s.pri)}>
              {t({ message: "Apply", comment: "verb: apply an edit Owlit suggested" })}
            </span>
          </div>
        </div>
      </div>
      {st.pop && (
        <div className={cn(s.mentionPop, s.pop, "menu-surface")} data-on={st.popOn || undefined} style={{ left: st.pop.x, top: st.pop.y }}>
          {WRITE.choices.map((p, i) => (
            <div key={p.title} className={s.mi} data-act={i === 0 || undefined}>
              <PaperIcon />
              <span className={s.t}>{p.title}</span>
              <span className={s.m}>{p.meta}</span>
            </div>
          ))}
        </div>
      )}
      {st.menu && (
        <div className={cn(s.selmenu, s.pop, "menu-surface")} data-on={st.menuOn || undefined} style={{ left: st.menu.x, top: st.menu.y }}>
          {/* The doc's own selection menu has Ask Owlit only: asked to tighten a sentence, Owlit suggests in place */}
          <span ref={reg("edit")} data-act={st.editPressed || undefined}>
            <OwlitMark />
            {t`Ask Owlit`}
          </span>
        </div>
      )}
    </>
  )
}
