import type { CardAction, CardView } from "../lib/messages.ts"

// The card the extension draws in the page, at its top right: what the button's click came to, in one
// sentence and at most one action. Plain DOM in a closed shadow root, so the page's CSS can't reach it
// and its own can't reach the page. The colours are the app's tokens (app/src/index.css), copied, since a
// page loads none of owlit's CSS: the floating material (popover, a faint ring of the foreground, the
// large shadow), light or dark as the browser is. The page's own fonts aren't owlit's, so it takes the
// system's.

// How long a card with nothing to decide stays before it fades; held while the pointer is on it
export const FADE_AFTER_MS = 2000

// The feather, as the toolbar icon draws it
const FEATHER = "M 53 225 C 55 167 85 93 136 58 C 164 39 199 32 211 45 C 228 64 191 96 155 111 C 128 122 107 137 91 154 C 108 140 126 128 146 124 C 171 117 176 128 159 145 C 146 158 124 164 111 169 C 134 163 143 177 125 190 C 114 198 101 201 91 201"

const CSS = `
:host { all: initial; }
.card {
  --popover: oklch(1 0 0); --foreground: oklch(0.21 0.008 60); --muted-foreground: oklch(0.505 0.012 65);
  --border: oklch(0.905 0.006 95); --accent: oklch(0.3 0.02 65 / 6%); --ring: oklch(0.21 0.008 60 / 8%);
  position: fixed; top: 16px; right: 16px; z-index: 2147483647; box-sizing: border-box;
  display: flex; gap: 10px; align-items: flex-start; width: max-content; max-width: min(360px, calc(100vw - 32px));
  padding: 12px 10px 12px 14px; border-radius: 14px; background: var(--popover); color: var(--foreground);
  box-shadow: 0 0 0 1px var(--ring), 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%);
  font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
  opacity: 0; transform: translateY(-4px); transition: opacity 100ms cubic-bezier(0.2, 0, 0, 1), transform 100ms cubic-bezier(0.2, 0, 0, 1);
}
@media (prefers-color-scheme: dark) {
  .card {
    --popover: oklch(0.255 0.006 95); --foreground: oklch(0.935 0.006 80); --muted-foreground: oklch(0.7 0.01 70);
    --border: oklch(0.935 0.01 95 / 10%); --accent: oklch(0.95 0.01 80 / 8%); --ring: oklch(0.935 0.006 80 / 14%);
  }
}
.card.shown { opacity: 1; transform: none; }
.card.leaving { opacity: 0; transition-duration: 150ms; }
svg.mark { flex: none; width: 16px; height: 16px; margin-top: 2px; }
.words { min-width: 0; flex: 1; }
.text { font-weight: 500; overflow-wrap: anywhere; }
.detail { margin-top: 2px; font-size: 13px; color: var(--muted-foreground); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
button { font: inherit; color: inherit; cursor: default; margin: 0; }
.action { flex: none; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border);
  background: transparent; font-size: 13px; font-weight: 500; }
.action:hover, .close:hover { background: var(--accent); }
.close { flex: none; display: grid; place-items: center; width: 24px; height: 24px; margin-left: -2px; border: 0;
  border-radius: 6px; background: transparent; color: var(--muted-foreground); }
button:focus-visible { outline: 2px solid var(--muted-foreground); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .card, .card.leaving { transition: none; } }
`

export interface CardHandlers {
  // The card's button was pressed (the card closes)
  act: (action: CardAction) => void
  // The person closed it
  closed: (key: string | undefined) => void
}

// A timer the card fades by; a test or another caller hands its own
export interface Timers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
const browserTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as number) }

// Draws the card, replacing the one shown; null takes it away. Returns how to take it away.
export function drawCard(doc: Document, view: CardView | null, handlers: CardHandlers, timers: Timers = browserTimers): () => void {
  doc.querySelector("owlit-card")?.remove()
  if (!view) return () => undefined
  const host = doc.createElement("owlit-card")
  const root = host.attachShadow({ mode: "closed" })
  const style = doc.createElement("style")
  style.textContent = CSS
  const card = doc.createElement("div")
  card.className = "card"
  card.setAttribute("role", "status")
  card.setAttribute("aria-live", "polite")

  const mark = icon(doc, "30 20 220 220", FEATHER, 18)
  mark.setAttribute("class", "mark")

  const words = doc.createElement("div")
  words.className = "words"
  const text = doc.createElement("div")
  text.className = "text"
  text.textContent = view.text
  words.append(text)
  if (view.detail) {
    const detail = doc.createElement("div")
    detail.className = "detail"
    detail.textContent = view.detail
    words.append(detail)
  }
  card.append(mark, words)

  let fade: unknown
  const remove = () => {
    timers.clear(fade)
    host.remove()
  }
  const leave = () => {
    card.classList.add("leaving")
    fade = timers.set(remove, 150)
  }
  if (view.action) {
    const { label, do: action } = view.action
    const button = doc.createElement("button")
    button.className = "action"
    button.type = "button"
    button.textContent = label
    button.addEventListener("click", () => {
      remove()
      handlers.act(action)
    })
    card.append(button)
  }
  const close = doc.createElement("button")
  close.className = "close"
  close.type = "button"
  close.setAttribute("aria-label", view.close)
  const cross = icon(doc, "0 0 24 24", "M18 6 6 18M6 6l12 12", 2)
  cross.setAttribute("width", "14")
  cross.setAttribute("height", "14")
  close.append(cross)
  close.addEventListener("click", () => {
    remove()
    handlers.closed(view.key)
  })
  card.append(close)

  if (!view.stays) {
    const later = () => (fade = timers.set(leave, FADE_AFTER_MS))
    card.addEventListener("mouseenter", () => timers.clear(fade))
    card.addEventListener("mouseleave", later)
    later()
  }
  root.append(style, card)
  doc.documentElement.append(host)
  // Shown on the next frame, so it moves in rather than appearing
  requestAnimationFrame(() => card.classList.add("shown"))
  return remove
}

// A line drawing in the text's colour; built, not parsed, so no markup is ever set in the page
function icon(doc: Document, viewBox: string, d: string, stroke: number) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", viewBox)
  svg.setAttribute("aria-hidden", "true")
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path")
  for (const [name, value] of Object.entries({ d, fill: "none", stroke: "currentColor", "stroke-width": String(stroke), "stroke-linecap": "round", "stroke-linejoin": "round" })) path.setAttribute(name, value)
  svg.append(path)
  return svg
}
