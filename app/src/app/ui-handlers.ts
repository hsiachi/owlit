// What agents can show the user in this window (ui.open, ui.jump, ui.mark from core, which
// owlit-mcp offers agents as tools): a paper, doc or chat opened, a passage ringed or selected, a
// passage highlighted. Each answers with the title of what it showed, or refuses in a sentence the
// agent reads. The channel they come over is lib/ui-actions.

import { parseOwlitUri } from "@owlit/protocol"
import { EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { appLinkTitle, openAppLink } from "@/app/app-links"
import type { router as appRouter } from "@/app/router"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { openEditor, onEditorsChanged } from "@/features/docs/editors"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import { fileAt } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import type { PassageTarget } from "@/features/library/reader/passages"
import { whenReaderReady } from "@/features/library/reader/reader-store"
import { useLibraryStore } from "@/features/library/store"
import { registerUiHandler, waitFor } from "@/lib/ui-actions"

const EDITOR_WITHIN_MS = 5_000

type Target = { kind: "paper"; id: string; title: string } | { kind: "doc"; id: string; title: string } | { kind: "other"; title: string }

function target(uri: string): Target {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") {
    const { papers, aliases } = useLibraryStore.getState()
    const id = papers[u.id] ? u.id : aliases[u.id]
    if (!id || !papers[id]) throw new Error("That paper isn't in the library.")
    return { kind: "paper", id, title: papers[id].title }
  }
  if (u?.kind === "doc") {
    const file = fileAt(u.path)
    if (!file) throw new Error(`There is no doc at ${u.path}.`)
    return { kind: "doc", id: file.id, title: displayName(file.path) }
  }
  if (u?.kind === "chat") {
    const found = useChatStore.getState().chats[u.id]
    if (!found) throw new Error("There is no such chat.")
    return { kind: "other", title: found.title || "the chat" }
  }
  if (!mentionRoute(uri)) throw new Error(`owlit has nothing at ${uri}.`)
  return { kind: "other", title: mentionTitle(uri) ?? uri }
}

// A quoted passage as the reader finds passages: by a phrase that opens it and one that closes it
function passageOf(quote: string, page?: number): PassageTarget {
  const words = quote.trim().split(/\s+/)
  const n = Math.min(8, words.length)
  return { id: `agent:${quote}`, start: words.slice(0, n).join(" "), end: words.slice(-n).join(" "), page: page ? page - 1 : undefined }
}

// The paper's reader, once it has laid out its pages
function reader(id: string) {
  const paper = useLibraryStore.getState().papers[id]
  if (!paper.pdf) throw new Error(`${paper.title} has no PDF in owlit yet.`)
  return whenReaderReady(id)
}

// Where a quote is in a doc: word for word, else the same words with any Markdown or line breaks
// between them
function findInDoc(text: string, quote: string) {
  const at = text.indexOf(quote)
  if (at >= 0) return { from: at, to: at + quote.length }
  const words = quote.match(/[\p{L}\p{N}]+/gu)
  if (!words) return null
  const m = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+"), "u").exec(text)
  return m ? { from: m.index, to: m.index + m[0].length } : null
}

export function startUiHandlers(router: typeof appRouter) {
  // Leaving the chat whose agent asked would hide its next question and its answer: the chat carries on
  // in the agent window, beside what it showed
  const show = async (uri: string, chatId?: string) => {
    // Settings or the shortcut list open over the page
    const app = appLinkTitle(uri)
    if (app && openAppLink(uri)) return { kind: "other" as const, title: app }
    const t = target(uri)
    const route = mentionRoute(uri.replace(/#.*$/, ""))
    if (!route || router.state.location.pathname === route) return t
    const watching = !!chatId && router.state.location.pathname === `/chat/${chatId}`
    await router.navigate(route)
    if (watching && !route.startsWith("/chat/")) useAgentWindow.getState().showChat(chatId)
    return t
  }

  registerUiHandler("open", async ({ uri, chatId }) => ({ title: (await show(uri, chatId)).title }))

  registerUiHandler("jump", async ({ uri, page, quote, chatId }) => {
    const t = target(uri)
    if (t.kind === "other") throw new Error("Only papers and docs have places to go to; open this one instead.")
    await show(uri, chatId)
    if (t.kind === "paper") {
      const api = await reader(t.id)
      if (!quote) {
        if (page) api.showPage(page - 1)
        return { title: t.title, found: true }
      }
      const found = await api.showPassage(passageOf(quote, page), "jump")
      if (!found && page) api.showPage(page - 1)
      return { title: t.title, found }
    }
    await waitFor(() => openEditor(t.id), onEditorsChanged, EDITOR_WITHIN_MS, "The doc didn't open in time.")
    // The editor that stays: one made while the page mounts can be replaced at once (StrictMode)
    await new Promise((r) => setTimeout(r))
    const view = openEditor(t.id)
    if (!view) throw new Error("The doc didn't open in time.")
    if (!quote) return { title: t.title, found: true }
    const at = findInDoc(view.state.doc.toString(), quote)
    if (!at) return { title: t.title, found: false }
    view.dispatch({ selection: EditorSelection.single(at.from, at.to), effects: EditorView.scrollIntoView(at.from, { y: "center" }) })
    view.focus()
    return { title: t.title, found: true }
  })

  registerUiHandler("mark", async ({ uri, quote, color, chatId }) => {
    const t = target(uri)
    if (t.kind !== "paper") throw new Error("Only passages in a paper can be highlighted.")
    await show(uri, chatId)
    const api = await reader(t.id)
    const h = await api.markPassage(passageOf(quote), color ?? "yellow")
    if (!h) throw new Error(`That passage isn't in ${t.title}'s PDF word for word; quote it as library_read gives it.`)
    return { title: t.title, highlightId: h.id, page: h.page + 1 }
  })
}
