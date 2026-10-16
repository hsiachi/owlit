import { plural, t } from "@lingui/core/macro"
import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useShallow } from "zustand/react/shallow"
import { LibraryIcon, type LucideIcon } from "lucide-react"
import { KIND_ICON } from "@/lib/kinds"
import { connectorProblem, problemSentence } from "@/features/chat/lib/connector-status"
import { regenerate } from "@/features/chat/lib/regenerate"
import { askSentence } from "@/features/chat/lib/step-words"
import { callOf, chatWait, useSeenStore } from "@/features/chat/status"
import { useChatStore } from "@/features/chat/store"
import { importOrigin } from "@/features/library/components/ImportBanner"
import { getInBrowser, showBrowser, useFromBrowser, useOfferedPdfs } from "@/features/library/from-browser"
import { useAskingImports } from "@/features/library/imports"
import { citationLabel } from "@/features/library/lib/format"
import type { Paper } from "@owlit/protocol"
import { useLibraryUi } from "@/features/library/ui-store"
import { openSettings, useSettings } from "@/features/settings/store"

// Everything stuck on the user, worked out once: Home lists it, the rail marks the place each thing is
// in, and Settings marks its section. Each is the thing and its fix, and leaves once answered.
export interface WaitingItem {
  key: string
  // Where it is: a rail place ("/chat", "/library"), or a Settings section ("settings:agents")
  place: string
  // The ladder's rung (DESIGN.md): waiting on the user (amber); working, said on Home beside what it
  // came from but marked nowhere; or, for the rail only, Owlit's dot for a reply finished unseen
  tone: "warning" | "working" | "owlit"
  icon: LucideIcon
  // In a few words, as Home's row and the rail's tooltip say it
  what: string
  where?: string
  // The full story when the line is short for it, such as the agent's own error message
  detail?: string
  // Where clicking the row goes, and the words at its right end for it
  open: { label: string; run: () => void }
  // A fix that isn't just going there, as a button at the right end instead of the words
  action?: { label: string; run: () => void }
  // Leave it as it is: only for a broken reply, which otherwise waits until it is run again
  dismiss?: () => void
}

// What holds up work comes first: a chat or an agent stopped on the user. A missing PDF only keeps a
// paper away, so papers come last, in as few lines as say what to do.
export function useWaitingOnYou(): WaitingItem[] {
  const navigate = useNavigate()
  const streaming = useChatStore((s) => s.streaming)
  const dismissed = useSeenStore((s) => s.dismissed)
  // Only the chats that wait on the user, newest first: a streamed reply changes its own chat, which
  // isn't one of them, so it redraws nothing here
  const stuck = useChatStore(
    useShallow((s) =>
      Object.values(s.chats)
        .filter((c) => chatWait(c, !!s.streaming[c.id], dismissed[c.id]))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  )
  // A reply Owlit finished while the user wasn't looking at its chat: the ladder's "changed since you
  // last looked" dot on the rail, so an answer that landed while they were reading reaches them
  const finished = useSeenStore((s) => Object.keys(s.unseen).length > 0)
  const connectors = useChatStore((s) => s.connectors)
  const selected = useChatStore((s) => s.selection.connectorId)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const imports = useAskingImports()
  const { run, waiting, pages, browser } = useFromBrowser()
  const offered = useOfferedPdfs()

  return useMemo(() => {
    const out: WaitingItem[] = []
    for (const chat of stuck) {
      const wait = chatWait(chat, !!streaming[chat.id], dismissed[chat.id])
      const title = chat.title
      const open = { label: t({ message: "Open", comment: "verb: open the chat that waits" }), run: () => navigate(`/chat/${chat.id}`) }
      const base = { place: "/chat", tone: "warning" as const, icon: KIND_ICON.chat, where: t`in “${title}”`, open }
      if (wait?.ask) {
        // In Owlit's words, as the card above the chat's composer says it: "Owlit wants to edit untitled.md"
        const { ask } = wait
        const what = ask.type === "permission" ? askSentence(ask.title, callOf(chat, ask.toolCallId)) : t`Owlit has a question`
        out.push({ ...base, key: `ask:${chat.id}`, what })
      } else if (wait?.broken) {
        const { broken } = wait
        const index = chat.messages.length - 1
        out.push({
          ...base,
          key: `fail:${chat.id}`,
          what: t`Owlit stopped`,
          detail: broken.error || undefined,
          // The row only opens the chat, so a stray click never runs anything again
          action: {
            label: t`Retry`,
            run: () => {
              navigate(`/chat/${chat.id}`)
              regenerate(chat.id, index)
            },
          },
          dismiss: () => useSeenStore.getState().dismiss(chat.id, broken.id),
        })
      }
    }
    // Only agents owlit would run: the one picked for chats and the one doing background work. One
    // nobody uses keeps its problem on its own row in Settings, unmarked.
    const used = new Set([selected, background].filter(Boolean))
    for (const c of connectors) {
      const problem = connectorProblem(c)
      if (!used.has(c.id) || !problem) continue
      const role = c.id === selected ? t`picked for chats` : t`picked for background work`
      out.push({
        key: `agent:${c.id}`,
        place: "settings:agents",
        tone: "warning",
        icon: KIND_ICON.agent,
        what: problemSentence(c) ?? "",
        where: problem === "error" && c.error ? `· ${c.error}` : `· ${role}`,
        open: { label: t`Manage agents`, run: () => openSettings("agents") },
      })
    }
    // An import started from the CLI stops to ask about MinerU; the Library's line has the answers
    for (const i of imports) {
      out.push({
        key: `import:${i.id}`,
        place: "/library",
        tone: "warning",
        icon: LibraryIcon,
        what: t`An import asks about MinerU`,
        where: importOrigin(i),
        open: { label: t`Answer`, run: () => navigate("/library") },
      })
    }
    // Papers owlit couldn't get alone wait for the user's own browser: one line whose button gets them
    // there in turn. While that runs, the line says how far it has got; stopped on the user, what their
    // browser may be asking, with the browser one click away. Papers whose page was opened there wait
    // for the user to save the PDF, on a line of their own.
    const paper = { place: "/library", icon: KIND_ICON.paper }
    if (run) {
      const { done, total } = run
      const show = { label: t`Show browser`, run: run.show }
      out.push(
        run.stopped
          ? { ...paper, key: "papers:from-browser", tone: "warning", what: run.what, where: t`· getting PDFs, ${done} of ${total}`, detail: run.detail, open: show, action: run.resume }
          : { ...paper, key: "papers:from-browser", tone: "working", what: run.what, where: t`· ${done} of ${total}`, open: show, action: run.stop },
      )
    } else if (waiting.length) {
      const one = waiting.length === 1
      out.push({
        ...paper,
        key: "papers:browser",
        tone: "warning",
        what: plural(waiting.length, { one: "A paper waits for your browser", other: "# papers wait for your browser" }),
        where: namesOf(waiting),
        open: one
          ? { label: t({ message: "Open", comment: "verb: open the paper that waits" }), run: () => navigate(`/library/${waiting[0].id}`) }
          : {
              label: t`Show them`,
              run: () => {
                useLibraryUi.getState().setFilter("needs")
                navigate("/library")
              },
            },
        action: { label: one ? t`Get it` : t`Get them`, run: () => void getInBrowser(waiting.map((p) => p.id)) },
      })
    }
    if (pages.length) {
      const n = pages.length
      out.push({
        ...paper,
        key: "papers:pages",
        tone: "warning",
        what: browser
          ? plural(n, { one: `Save the PDF from the page open in ${browser}`, other: `Save # PDFs from the pages open in ${browser}` })
          : plural(n, { one: "Save the PDF from the page open in your browser", other: "Save # PDFs from the pages open in your browser" }),
        where: namesOf(pages),
        open: { label: t`Show browser`, run: run?.show ?? (() => void showBrowser()) },
      })
    }
    // A file in Downloads owlit isn't sure is a paper's: its card asks which, so the row opens it
    if (offered.length) {
      const one = offered.length === 1
      const label = t`Downloaded PDFs to confirm`
      out.push({
        ...paper,
        key: "papers:offered",
        tone: "warning",
        what: plural(offered.length, { one: "A downloaded PDF to confirm", other: "# downloaded PDFs to confirm" }),
        where: namesOf(offered),
        open: one
          ? { label: t({ message: "Open", comment: "verb: open the paper that waits" }), run: () => navigate(`/library/${offered[0].id}`) }
          : {
              label: t`Show them`,
              run: () => {
                useLibraryUi.getState().showOnly(
                  offered.map((p) => p.id),
                  label,
                )
                navigate("/library")
              },
            },
      })
    }
    if (finished) out.push({ key: "chat:finished", place: "/chat", tone: "owlit", icon: KIND_ICON.chat, what: t`Owlit finished since you last looked`, open: { label: t({ message: "Open", comment: "verb: open the chat that waits" }), run: () => navigate("/chat") } })
    return out
  }, [stuck, streaming, dismissed, finished, connectors, selected, background, imports, run, waiting, pages, browser, offered, navigate])
}

// "for McDaniel & Einstein 2000, Nahum-Shani et al. 2016": one or two papers by name. More are only
// counted in the row's words: two names picked from many say nothing, and Show them lists them all with
// their titles (a hover list of authors and years didn't either)
function namesOf(papers: Paper[]) {
  if (papers.length > 2) return undefined
  const names = papers.map(citationLabel).join(", ")
  return t`for ${names}`
}
