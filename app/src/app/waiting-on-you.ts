import { t } from "@lingui/core/macro"
import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useShallow } from "zustand/react/shallow"
import { LibraryIcon, type LucideIcon } from "lucide-react"
import { KIND_ICON } from "@/lib/kinds"
import { connectorProblem, problemSentence } from "@/features/chat/lib/connector-status"
import { regenerate } from "@/features/chat/lib/regenerate"
import { askSentence } from "@/features/chat/lib/step-words"
import { callOf, chatWait, useSeenStore } from "@/features/chat/status"
import { useSeen } from "./seen"
import { useChatStore } from "@/features/chat/store"
import { importOrigin } from "@/features/library/components/ImportBanner"
import { useAskingImports } from "@/features/library/imports"
import { openSettings, useSettings } from "@/features/settings/store"
import { useExtensionWaits } from "@/features/extension/store"
import { siteWaitItems } from "@/features/extension/waits"

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
  const finished = useSeen((s) => s.unseen.chats.length > 0)
  const connectors = useChatStore((s) => s.connectors)
  const selected = useChatStore((s) => s.selection.connectorId)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const imports = useAskingImports()
  const siteWaits = useExtensionWaits()

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
    // PDFs: only the sites the extension waits at, once the user asked for one of their papers
    out.push(...siteWaitItems(siteWaits, () => navigate("/library")))
    if (finished) out.push({ key: "chat:finished", place: "/chat", tone: "owlit", icon: KIND_ICON.chat, what: t`Owlit finished since you last looked`, open: { label: t({ message: "Open", comment: "verb: open the chat that waits" }), run: () => navigate("/chat") } })
    return out
  }, [stuck, streaming, dismissed, finished, connectors, selected, background, imports, siteWaits, navigate])
}
