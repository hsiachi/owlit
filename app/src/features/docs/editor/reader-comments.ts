import { plural, t } from "@lingui/core/macro"
import { locateInMarkdown } from "@owlit/protocol"
import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view"
import { ago } from "@/lib/time"
import type { Thread } from "../share/store"

// Readers' comments on a shared doc. They come from the share link's readers (core's share.*), who saw the
// doc drawn in a browser; their passage is found again in the Markdown by its words (protocol's
// locateInMarkdown). They are drawn like Owlit's notes (agent-notes.ts), in a person's ink rather than
// Owlit's green, and signed: the words carry a 2px underline, and a click opens the thread under the
// paragraph, with its replies and room to answer. Nothing here ever enters the file.

export const setThreads = StateEffect.define<Thread[]>()
export const setOpenThread = StateEffect.define<string | null>()

interface ThreadSpot {
  thread: Thread
  from: number
  to: number
  lost: boolean
}

interface CommentsState {
  spots: ThreadSpot[]
  open: string | null
  decos: DecorationSet
}

interface Actions {
  onOpen: (id: string | null) => void
  onReply: (thread: Thread, text: string) => Promise<void>
  onResolve: (thread: Thread) => void
}

const lostSpot = (state: EditorState, thread: Thread): ThreadSpot => ({ thread, from: 0, to: state.doc.line(1).to, lost: true })

function locate(state: EditorState, thread: Thread): ThreadSpot {
  const at = locateInMarkdown(state.doc.toString(), thread.root.anchor)
  return at ? { thread, from: at.from, to: at.to, lost: false } : lostSpot(state, thread)
}

// The open thread, under its paragraph: the reader's comment, the replies, a field to answer, Resolve
class ThreadWidget extends WidgetType {
  readonly spot: ThreadSpot
  readonly actions: Actions
  constructor(spot: ThreadSpot, actions: Actions) {
    super()
    this.spot = spot
    this.actions = actions
  }
  // Redrawn only when the thread itself changed, so a reply being typed survives edits elsewhere
  eq(other: ThreadWidget) {
    const a = other.spot.thread
    const b = this.spot.thread
    return a.root.id === b.root.id && a.replies.length === b.replies.length && other.spot.lost === this.spot.lost
  }
  toDOM(view: EditorView) {
    const { thread, lost } = this.spot
    const el = (tag: string, className?: string, text?: string) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }
    const button = (label: string, run: () => void, className?: string) => {
      const b = el("button", className, label) as HTMLButtonElement
      b.type = "button"
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = run
      return b
    }

    const box = el("div", "cm-person")
    const said = (c: Thread["root"] | Thread["replies"][number]) => {
      const part = el("div", "cm-person-said")
      const who = c.by === "author" ? t`${c.name} (you)` : c.name
      part.append(el("div", "cm-person-head", `${who} · ${ago(c.at, { inSentence: false })}`), el("p", "cm-person-text", c.text))
      return part
    }
    if (lost) {
      const q = thread.root.anchor.quote
      box.append(el("p", "cm-person-lost", t`The words this comment was on have changed: “${q.length > 90 ? `${q.slice(0, 90)}…` : q}”`))
    }
    box.append(said(thread.root))
    for (const reply of thread.replies) box.append(said(reply))

    // Answering: the field opens on Reply, and sends with ⌘↵ or its own button
    const actions = el("div", "cm-person-actions")
    const form = el("div", "cm-person-reply")
    const field = el("textarea") as HTMLTextAreaElement
    field.rows = 2
    field.placeholder = t`Reply…`
    field.setAttribute("aria-label", t`Reply`)
    const send = button(t`Send`, () => void submit(), "cm-person-send")
    const cancel = button(t`Cancel`, () => {
      form.hidden = true
      actions.hidden = false
    })
    const row = el("div", "cm-person-reply-row")
    row.append(cancel, send)
    form.append(field, row)
    form.hidden = true
    const submit = async () => {
      const text = field.value.trim()
      if (!text) return
      send.disabled = true
      try {
        await this.actions.onReply(thread, text)
      } catch {
        send.disabled = false
      }
    }
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void submit()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        cancel.click()
      }
    })
    actions.append(
      button(t`Reply`, () => {
        actions.hidden = true
        form.hidden = false
        field.focus()
      }),
      button(t`Resolve`, () => this.actions.onResolve(thread)),
    )
    box.append(form, actions)

    // Opens under its paragraph the way an Owlit note does (index.css, Unfold)
    const fold = el("div", "unfold cm-person-fold")
    const inner = el("div", "unfold-inner")
    inner.append(box)
    fold.append(inner)
    requestAnimationFrame(() => {
      fold.dataset.state = "open"
    })
    fold.addEventListener("transitionend", (e) => {
      if (e.target === fold && e.propertyName === "grid-template-rows") {
        fold.dataset.settled = ""
        view.requestMeasure()
      }
    })
    return fold
  }
  ignoreEvent() {
    return true
  }
}

const commentActions = Facet.define<Actions, Actions>({ combine: (values) => values[0] })

const commentsField = StateField.define<CommentsState>({
  create: () => ({ spots: [], open: null, decos: Decoration.none }),
  update(value, tr) {
    let { spots, open } = value
    if (tr.docChanged)
      spots = spots.map((s) => {
        if (s.lost) return locate(tr.state, s.thread)
        const from = tr.changes.mapPos(s.from, 1)
        const to = tr.changes.mapPos(s.to, -1)
        return to > from ? { ...s, from, to } : lostSpot(tr.state, s.thread)
      })
    for (const e of tr.effects) {
      if (e.is(setThreads)) {
        const kept = new Map(spots.map((s) => [s.thread.root.id, s]))
        spots = e.value.map((thread) => {
          const spot = kept.get(thread.root.id)
          return spot ? { ...spot, thread } : locate(tr.state, thread)
        })
      }
      if (e.is(setOpenThread)) open = e.value
    }
    if (open && !spots.some((s) => s.thread.root.id === open)) open = null
    if (spots === value.spots && open === value.open) return value

    const decos: Range<Decoration>[] = []
    for (const s of spots) {
      if (s.lost) continue
      const isOpen = s.thread.root.id === open
      decos.push(Decoration.mark({ class: isOpen ? "cm-person-mark cm-person-mark-open" : "cm-person-mark", attributes: { "data-thread": s.thread.root.id } }).range(s.from, s.to))
    }
    const opened = spots.find((s) => s.thread.root.id === open)
    if (opened) decos.push(Decoration.widget({ widget: new ThreadWidget(opened, tr.state.facet(commentActions)), block: true, side: 1 }).range(tr.state.doc.lineAt(opened.to).to))
    return { spots, open, decos: Decoration.set(decos, true) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
})

// Where each thread sits now, for the header's count to step through them in reading order
export function threadSpots(state: EditorState): ThreadSpot[] {
  return state.field(commentsField, false)?.spots ?? []
}

export function readerComments(actions: Actions): Extension {
  const clicks = EditorView.domEventHandlers({
    click(e, view) {
      if (e.button !== 0 || !view.state.selection.main.empty) return false
      const id = (e.target as HTMLElement).closest?.("[data-thread]")?.getAttribute("data-thread") ?? null
      const { open } = view.state.field(commentsField)
      if (id !== open && (id || open)) actions.onOpen(id)
      return false
    },
  })
  const esc = keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(commentsField).open) return false
        actions.onOpen(null)
        return true
      },
    },
  ])
  const theme = EditorView.theme({
    // A person's ink (index.css --person-mark): neither Owlit's green nor a link's blue
    ".cm-person-mark": {
      textDecorationLine: "underline",
      textDecorationColor: "var(--person-mark)",
      textDecorationThickness: "2px",
      textUnderlineOffset: "5px",
      textDecorationSkipInk: "none",
    },
    ".cm-person-mark-open": { backgroundColor: "var(--person-wash)" },
    ".cm-person-fold": { marginLeft: "-16px" },
    ".cm-person": {
      margin: "4px 0 14px",
      padding: "8px 12px 6px 13px",
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderLeft: "3px solid var(--person-mark)",
      borderRadius: "4px 10px 10px 4px",
      fontSize: "14px",
      lineHeight: "1.55",
      cursor: "default",
    },
    ".cm-person p": { margin: "0" },
    ".cm-person-said + .cm-person-said": { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border)" },
    ".cm-person-head": { fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "2px" },
    ".cm-person-text": { whiteSpace: "pre-wrap" },
    ".cm-person-lost": { fontSize: "13px", color: "var(--muted-foreground)", marginBottom: "6px !important" },
    ".cm-person-reply": { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" },
    ".cm-person-reply[hidden]": { display: "none" },
    ".cm-person-reply textarea": {
      resize: "none",
      font: "inherit",
      fontSize: "14px",
      padding: "6px 10px",
      borderRadius: "10px",
      border: "1px solid var(--input)",
      background: "var(--background)",
      color: "var(--foreground)",
      outline: "none",
    },
    ".cm-person-reply textarea:focus": { borderColor: "var(--ring)" },
    ".cm-person-reply-row, .cm-person-actions": { display: "flex", justifyContent: "flex-end", gap: "2px", marginRight: "-6px" },
    ".cm-person-actions": { marginTop: "4px" },
    ".cm-person-actions[hidden]": { display: "none" },
    ".cm-person button": {
      height: "26px",
      padding: "0 8px",
      borderRadius: "8px",
      fontSize: "13px",
      background: "none",
      border: "none",
      color: "var(--muted-foreground)",
      cursor: "pointer",
    },
    ".cm-person button:hover": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
    ".cm-person button.cm-person-send": { background: "var(--primary)", color: "var(--primary-foreground)", fontWeight: "500", marginLeft: "4px" },
    ".cm-person button.cm-person-send:disabled": { opacity: "0.5" },
  })
  return [commentActions.of(actions), commentsField, clicks, esc, theme]
}

// "2 comments", for the header
export const commentCount = (n: number) => plural(n, { one: "# comment", other: "# comments" })
