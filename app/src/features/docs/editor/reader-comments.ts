import { plural, t } from "@lingui/core/macro"
import { locateInMarkdown } from "@owlit/protocol"
import type { Extension } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"
import { ago } from "@/lib/time"
import { shorten } from "@/lib/words"
import type { Thread } from "../share/store"
import { anchoredCards, cardButton, sideCardFold, sideCardTheme, washOpen, type Spot } from "./side-card"

// Readers' comments on a shared doc. They come from the share link's readers (core's share.*), who saw the
// doc drawn in a browser; their passage is found again in the Markdown by its words (protocol's
// locateInMarkdown). They are drawn like Owlit's notes (agent-notes.ts), in a person's ink rather than
// Owlit's green, and signed: the words carry a 2px underline, and a click opens the thread under the
// paragraph, with its replies and room to answer. Nothing here ever enters the file.

interface Actions {
  onOpen: (id: string | null) => void
  onReply: (thread: Thread, text: string) => Promise<void>
  onResolve: (thread: Thread) => void
}

// The open thread, under its paragraph: the reader's comment, the replies, a field to answer, Resolve
class ThreadWidget extends WidgetType {
  readonly spot: Spot<Thread>
  readonly actions: Actions
  constructor(spot: Spot<Thread>, actions: Actions) {
    super()
    this.spot = spot
    this.actions = actions
  }
  // Redrawn only when the thread itself changed, so a reply being typed survives edits elsewhere
  eq(other: ThreadWidget) {
    const a = other.spot.item
    const b = this.spot.item
    return a.root.id === b.root.id && a.replies.length === b.replies.length && other.spot.lost === this.spot.lost
  }
  toDOM(view: EditorView) {
    const { item: thread, lost } = this.spot
    const el = (tag: string, className?: string, text?: string) => {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
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
      box.append(el("p", "cm-person-lost", t`The words this comment was on have changed: “${shorten(q, 90)}”`))
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
    const send = cardButton(t`Send`, () => void submit(), "cm-person-send")
    const cancel = cardButton(t`Cancel`, () => {
      form.hidden = true
      actions.hidden = false
    })
    const row = el("div", "cm-person-actions cm-person-reply-row")
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
      cardButton(t`Reply`, () => {
        actions.hidden = true
        form.hidden = false
        field.focus()
      }),
      cardButton(t`Resolve`, () => this.actions.onResolve(thread)),
    )
    box.append(form, actions)

    // Opens under its paragraph the way an Owlit note does
    return sideCardFold(view, box, "cm-person-fold")
  }
  ignoreEvent() {
    return true
  }
}

const comments = anchoredCards<Thread, Actions>({
  attr: "thread",
  mark: "cm-person-mark",
  id: (thread) => thread.root.id,
  find: (text, thread) => locateInMarkdown(text, thread.root.anchor),
  card: (opened, _spots, actions) => new ThreadWidget(opened, actions),
})

export const { setItems: setThreads, setOpen: setOpenThread } = comments

// Where each thread sits now, for the header's count to step through them in reading order
export const threadSpots = comments.spotsOf

export function readerComments(actions: Actions): Extension {
  const theme = EditorView.theme({
    // The card and the underline in a person's ink (index.css --person-mark), neither Owlit's green nor a
    // link's blue; the shape is Owlit's note's (side-card.ts)
    ...sideCardTheme("cm-person", "var(--person-mark)"),
    ".cm-person-mark-open": { backgroundColor: "var(--person-wash)", animation: washOpen },
    ".cm-person-said + .cm-person-said": { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border)" },
    ".cm-person-text": { whiteSpace: "pre-wrap" },
    ".cm-person-reply": { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" },
    ".cm-person-reply[hidden]": { display: "none" },
    ".cm-person-reply-row": { marginTop: "0" },
    ".cm-person-actions button.cm-person-send": { background: "var(--primary)", color: "var(--primary-foreground)", fontWeight: "500", marginLeft: "4px" },
    ".cm-person-actions button.cm-person-send:disabled": { opacity: "0.5" },
  })
  return [comments.extension(actions), theme]
}

// "2 comments", for the header
export const commentCount = (n: number) => plural(n, { one: "# comment", other: "# comments" })
