import { plural, t } from "@lingui/core/macro"
import { ArrowUpIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import { keysFor } from "@/app/shortcuts"
import { ASK } from "./content"
import { useScript, words } from "./engine"
import { Layers, MiniComposer, Ring } from "./parts"
import { useDemoPlace, type DemoPlace } from "./place"
import s from "./demos.module.css"

interface AskState {
  view: "paper" | "chat"
  place: DemoPlace
  // Owlit's dot on Chat in the rail, while the hand-off's result is new
  dot: boolean
  // ⌘J over the paper, the ask bar, the answer beside the page
  keys: "off" | "on" | "down"
  dim: boolean
  bar: boolean
  question: string
  panel: boolean
  read: boolean
  // How many of the answer's words have come in
  words: number
  // The hand-off in Chat: what is typed, then sent, its step, its result
  typed: string | null
  sent: boolean
  searched: "off" | "working" | "done"
  result: boolean
}

const FIRST: AskState = {
  view: "paper",
  place: "library",
  dot: false,
  keys: "off",
  dim: false,
  bar: false,
  question: "",
  panel: false,
  read: false,
  words: 0,
  typed: null,
  sent: false,
  searched: "off",
  result: false,
}

// Ask: ⌘J over a paper asks about it beside the page; then, in Chat, longer work is handed off and comes
// back as a result. The scene moves from the Library to Chat, and says so to the window's rail.
export function AskDemo() {
  const answer = words(ASK.answer, "en")
  const { layers } = useScript<AskState>({
    initial: () => FIRST,
    final: () => ({ ...FIRST, view: "chat", place: "chat", dot: true, typed: null, sent: true, searched: "done", result: true }),
    script: async (c) => {
      await c.sleep(800)
      c.set({ keys: "on" })
      await c.sleep(450)
      c.set({ keys: "down" })
      await c.sleep(220)
      c.set({ keys: "on" })
      await c.sleep(250)
      c.set({ keys: "off", dim: true, bar: true })
      await c.sleep(20)
      await c.type("question", ASK.question, 40)
      await c.sleep(400)
      c.set({ bar: false, dim: false, panel: true })
      await c.sleep(1730)
      c.set({ read: true })
      for (let i = 1; i <= answer.length; i++) {
        c.set({ words: i })
        await c.sleep(65)
      }
      await c.sleep(2200)
      // The hand-off, in Chat
      c.scene({ ...FIRST, view: "chat", place: "chat" })
      await c.sleep(500)
      c.set({ typed: "" })
      await c.type("typed", ASK.handOff, 24)
      await c.sleep(300)
      c.set({ sent: true, searched: "working" })
      await c.sleep(1820)
      c.set({ searched: "done", dot: true, result: true })
      await c.sleep(3220)
      c.set({ dot: false })
    },
  })
  const now = layers[layers.length - 1].state
  useDemoPlace(now.place, now.dot ? "chat" : null)

  return <Layers layers={layers}>{(st) => (st.view === "paper" ? <PaperView st={st} answer={answer} /> : <ChatView st={st} />)}</Layers>
}

function PaperView({ st, answer }: { st: AskState; answer: string[] }) {
  const PaperIcon = KIND_ICON.paper
  const pages = ASK.pages
  const paper = ASK.paper
  return (
    <>
      <div className={s.reader} data-dim={st.dim || undefined}>
        <div className={s.pagewrap}>
          <div className={s.page} style={{ fontSize: 10 }}>
            <div className={s.sec} style={{ marginTop: 0 }}>
              {ASK.section}
            </div>
            <p>{ASK.body}</p>
            <div className={s.sec}>{ASK.section2}</div>
            <p>{ASK.body2}</p>
          </div>
        </div>
        <div className={s.side}>
          <div className={s.pt}>{ASK.paper}</div>
          <div className={s.mut} style={{ fontSize: 10.5, marginTop: 4 }}>
            {ASK.meta}
          </div>
        </div>
      </div>
      <div className={s.keys} data-on={st.keys !== "off" || undefined} data-down={st.keys === "down" || undefined}>
        {[...keysFor("owlit")].map((k) => (
          <span key={k}>{k}</span>
        ))}
      </div>
      <div className={cn(s.askbar, s.pop, "bg-card shadow-md ring-1 ring-border")} data-on={st.bar || undefined}>
        <span className={s.chip}>
          <PaperIcon />
          {ASK.paper}
        </span>
        <span className={s.q}>{st.question}</span>
        <span className={s.send}>
          <ArrowUpIcon />
        </span>
      </div>
      <div className={s.panel} data-on={st.panel || undefined}>
        <div className={s.bubble}>{ASK.question}</div>
        <div className={s.step}>
          <Ring done={st.read} />
          <span className={cn(!st.read && "shimmer")}>{st.read ? t`Read ${paper}, pages ${pages}` : t`Reading ${paper}, pages ${pages}`}</span>
        </div>
        <div className={s.answer}>
          {answer.slice(0, st.words).map((w, i) => (
            <span key={i} className={s.wordIn}>
              {w}
            </span>
          ))}
          {st.words >= answer.length && <span className={s.cite}> {ASK.answerPage}</span>}
        </div>
      </div>
    </>
  )
}

function ChatView({ st }: { st: AskState }) {
  const PaperIcon = KIND_ICON.paper
  const found = ASK.found
  const kept = ASK.added.length
  return (
    <div className={s.chat}>
      {st.sent && <div className={cn(s.bubble, s.wordIn)}>{ASK.handOff}</div>}
      <div>
        {st.searched !== "off" && (
          <div className={cn(s.step, s.fadein)}>
            <Ring done={st.searched === "done"} />
            {st.searched === "done" ? (
              <span>{t`Searched arXiv and Semantic Scholar · ${found} found, ${kept} kept`}</span>
            ) : (
              <span className="shimmer">{t`Searching arXiv and Semantic Scholar`}</span>
            )}
          </div>
        )}
        {st.result && (
          <div className={cn(s.result, s.fadein)}>
            <div className={s.rh}>
              <Ring done />
              {plural(kept, { one: "Added # paper to your Library", other: "Added # papers to your Library" })}
              <span className={s.u}>{t`Undo`}</span>
            </div>
            {ASK.added.map((p) => (
              <div key={p.title} className={s.rr}>
                <PaperIcon />
                <span className={s.t}>{p.title}</span>
                <span className={s.m}>{p.meta}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <MiniComposer
        text={st.sent ? null : st.typed}
        placeholder={st.sent ? t`Ask a follow-up…` : t`Ask about your papers, docs or notes…`}
        agentName={ASK.agent}
      />
    </div>
  )
}
