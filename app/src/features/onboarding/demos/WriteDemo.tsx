import { plural, t } from "@lingui/core/macro"
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
  // Owlit's rewrite, landed in the doc: the old words struck, the new ones typed in, with Owlit's marks
  // and the line that offers Undo
  struck: boolean
  rewrite: string | null
  bar: boolean
  // The pointer over the Undo the person could press
  undoHover: boolean
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
  undoHover: false,
}

// Write: a sentence typed, a paper cited with @, the sentence handed to Owlit to edit, its rewrite landing
// in the doc with Owlit's marks and an Undo, as an edit lands in the app: nothing to apply, any part undone
export function WriteDemo() {
  useDemoPlace("docs")
  const { layers, cursor, root, reg } = useScript<WriteState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, typed: WRITE.typed, cited: true, caret: false, struck: true, rewrite: WRITE.rewritten, bar: true }),
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
      // The way back is there, and left alone: the words stay
      await c.moveToEl("undo", 0.5, 0.55, 800)
      c.set({ undoHover: true })
      await c.sleep(900)
      c.set({ undoHover: false })
      await c.moveTo(470, 380, 600)
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
  const landed = st.rewrite != null
  return (
    <>
      <div className={s.doc}>
        <div className={s.crumb}>{WRITE.crumb}</div>
        <div className={s.dt}>{WRITE.title}</div>
        <div className={cn(s.para, s.ruled)} data-rule={landed || undefined}>
          {WRITE.lead}
          <span className={s.cite}>{WRITE.leadCite}</span>.{" "}
          <span ref={reg("old")} className={cn(s.old, st.selected && s.txtsel)} data-struck={st.struck || undefined}>
            {st.typed}
          </span>
          {st.rewrite != null && <span className={s.ins}>{st.rewrite}</span>}
          {st.mention && <span className={s.cite}>{WRITE.mention}</span>}
          {st.cited && (
            <>
              <span className={s.citeIn}>{WRITE.cite}</span>.
            </>
          )}
          {st.caret && <span ref={reg("caret")} className={s.caret} />}
          {/* The line a doc draws over Owlit's landed edits: how many, and the way to take them back */}
          <div className={cn(s.suggestBar, s.pop)} data-on={st.bar || undefined}>
            <span>{plural(1, { one: "Owlit changed # passage", other: "Owlit changed # passages" })}</span>
            <span ref={reg("undo")} className={s.b} data-hover={st.undoHover || undefined}>
              {t({ message: "Undo", comment: "verb: undo a passage Owlit changed" })}
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
