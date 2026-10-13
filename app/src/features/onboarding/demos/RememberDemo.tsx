import { plural, t } from "@lingui/core/macro"
import { HighlighterIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import { REMEMBER } from "./content"
import { useScript } from "./engine"
import { Cursor, Layers } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

interface RememberState {
  // How many of the three sources have come up, then whether they have flown into the topic
  sources: number
  flown: boolean
  topic: boolean
  lines: number
  // The person corrects Owlit's line: it opens for editing, is rewritten, and becomes theirs
  editing: boolean
  rewritten: string | null
  corrected: boolean
}

const FIRST: RememberState = { sources: 0, flown: false, topic: false, lines: 0, editing: false, rewritten: null, corrected: false }

// Where each source sits, and where it flies to (into the topic above)
const SOURCES = [
  { left: 40, top: 330, fly: "translate(150px, -250px) scale(.6)" },
  { left: 220, top: 370, fly: "translate(-30px, -290px) scale(.6)" },
  { left: 390, top: 330, fly: "translate(-200px, -250px) scale(.6)" },
]

// Remember: what you highlighted, wrote and asked flows into a topic; each line says who said it, and one
// of Owlit's is corrected by hand
export function RememberDemo() {
  useDemoPlace("knowledge")
  const { layers, cursor, root, reg } = useScript<RememberState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, sources: 3, flown: true, topic: true, lines: 3, rewritten: REMEMBER.correctedStart + REMEMBER.correctedEnd, corrected: true }),
    script: async (c) => {
      await c.sleep(300)
      for (let i = 1; i <= 3; i++) {
        c.set({ sources: i })
        await c.sleep(250)
      }
      await c.sleep(900)
      c.set({ flown: true })
      await c.sleep(600)
      c.set({ topic: true })
      for (let i = 1; i <= 3; i++) {
        c.set({ lines: i })
        await c.sleep(920)
      }
      await c.sleep(700)
      await c.moveTo(480, 390, 10)
      await c.sleep(30)
      await c.moveToEl("owlLine", 0.5, 0.6, 800)
      await c.click()
      c.hideCursor()
      c.set({ editing: true })
      await c.sleep(400)
      c.set({ rewritten: REMEMBER.correctedStart })
      await c.sleep(200)
      await c.type("rewritten", REMEMBER.correctedEnd, 32)
      await c.sleep(500)
      c.set({ editing: false, corrected: true })
      await c.sleep(3000)
    },
  })

  return (
    <div ref={root} className="absolute inset-0">
      <Layers layers={layers}>{(st) => <KnowledgeView st={st} reg={reg} />}</Layers>
      <Cursor {...cursor} />
    </div>
  )
}

type Reg = (name: string) => (el: HTMLElement | null) => () => void

function KnowledgeView({ st, reg }: { st: RememberState; reg: Reg }) {
  const [highlight, doc, chat] = REMEMBER.sources
  const sources = [
    { icon: HighlighterIcon, label: t`Highlight · ${highlight}` },
    { icon: KIND_ICON.doc, label: t`Your doc · ${doc}` },
    { icon: KIND_ICON.chat, label: t`Chat · ${chat}` },
  ]
  const when = t`just now`
  const n = 1
  const speakers = [
    t({ message: "You", comment: "the speaker of a topic's line: You wrote, You said" }),
    t({ message: "The paper", comment: "the speaker of a topic's line: the paper it came from" }),
    t({ message: "Owlit thinks", comment: "the speaker of a topic's line: Owlit's own reading" }),
  ]
  return (
    <>
      <div className={s.kn}>
        <div className={s.h}>{t`Knowledge`}</div>
        <div className={s.mut} style={{ marginTop: 4, fontSize: 11 }}>
          {st.topic ? plural(n, { one: `Updated ${when} · # topic`, other: `Updated ${when} · # topics` }) : t`Owlit is reading what you’ve touched…`}
        </div>
        {st.topic && (
          <div className={cn(s.topic, s.fadein)}>
            <div className={s.topicHead}>
              <i />
              {REMEMBER.topic}
            </div>
            {REMEMBER.lines.slice(0, st.lines).map((line, i) => {
              const owlit = i === 2 && !st.corrected
              return (
                <div key={i} className={cn(s.kline, s.fadein)} data-owl={owlit || undefined}>
                  <span className={s.who}>{i === 2 && st.corrected ? speakers[0] : speakers[i]}</span>
                  <span>
                    <span ref={i === 2 ? reg("owlLine") : undefined} className={cn(s.txt, i === 2 && st.editing && s.editBox)}>
                      {i === 2 && st.rewritten != null ? st.rewritten : line.text}
                    </span>
                    <span className={s.src2}>{i === 2 && st.corrected ? t`You corrected Owlit’s line` : line.source}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {sources.map((src, i) => {
        const at = SOURCES[i]
        return (
          <div
            key={i}
            className={cn(s.src, "bg-card shadow-xs ring-1 ring-border")}
            data-shown={(st.sources > i && !st.flown) || undefined}
            data-flown={st.flown || undefined}
            style={{ left: at.left, top: at.top, transform: st.flown ? at.fly : undefined }}
          >
            <src.icon />
            {src.label}
          </div>
        )
      })}
    </>
  )
}
