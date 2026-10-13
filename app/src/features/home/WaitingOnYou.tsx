import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { plural, t } from "@lingui/core/macro"
import { ChevronRightIcon, LibraryIcon, XIcon, type LucideIcon } from "lucide-react"
import { GroupLabel } from "@/components/group-label"
import { IconButton } from "@/components/icon-button"
import { Button } from "@/components/ui/button"
import { KIND_ICON } from "@/lib/kinds"
import { connectorProblem, problemSentence } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { brokenReply, pendingAsk, useSeenStore } from "@/features/chat/status"
import { askSentence, type ToolCall } from "@/features/chat/lib/step-words"
import { regenerate } from "@/features/chat/lib/regenerate"
import { useLibraryStore } from "@/features/library/store"
import { useCheckQueue } from "@/features/library/check-queue"
import { citationLabel } from "@/features/library/lib/format"
import type { Paper } from "@/features/library/types"
import { openSettings, useSettings } from "@/features/settings/store"
import { useLoginTasks } from "@/features/tasks/store"

// Everything stuck on the user, in one list: a permission a chat waits for, a publisher that wants a
// check, handed-off work that broke, an agent that can't run, a library sign-in. Each line is the thing
// and its fix; it leaves once answered. The whole row is the way to the fix, as every row on Home is a
// link, and its right end says what clicking does ("Check now ›"); a real button is kept only for a fix
// that does something other than going there (Retry). Shown only while something waits, in the rows' own look (Home's
// Recent), not a card. The places these come from keep their own marks (a chat's status ring, the rail's
// dots). What holds up work comes first: a chat or an agent stopped on the user. A publisher's check only
// keeps a PDF away, so papers come last, and three or more of one kind share a line.
interface Waiting {
  key: string
  icon: LucideIcon
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

function useWaiting(): Waiting[] {
  const navigate = useNavigate()
  const chats = useChatStore((s) => s.chats)
  const streaming = useChatStore((s) => s.streaming)
  const connectors = useChatStore((s) => s.connectors)
  const selected = useChatStore((s) => s.selection.connectorId)
  const dismissed = useSeenStore((s) => s.dismissed)
  const papers = useLibraryStore((s) => s.papers)
  const background = useSettings((s) => s.view?.backgroundAgent)
  const loginTask = useLoginTasks()[0]

  return useMemo(() => {
    const out: Waiting[] = []
    for (const chat of Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const ask = streaming[chat.id] ? pendingAsk(chat) : undefined
      const broken = streaming[chat.id] ? undefined : brokenReply(chat, dismissed[chat.id])
      const title = chat.title
      const open = { label: t({ message: "Open", comment: "verb: open the chat that waits" }), run: () => navigate(`/chat/${chat.id}`) }
      if (ask) {
        // In Owlit's words, as the card above the chat's composer says it: "Owlit wants to edit untitled.md"
        const call = chat.messages.at(-1)?.parts.find((p): p is ToolCall => p.type === "tool_call" && p.toolCallId === ask.toolCallId)
        const what = ask.type === "permission" ? askSentence(ask.title, call) : t`Owlit has a question`
        out.push({ key: `ask:${chat.id}`, icon: KIND_ICON.chat, what, where: t`in “${title}”`, open })
      } else if (broken) {
        const index = chat.messages.length - 1
        out.push({
          key: `fail:${chat.id}`,
          icon: KIND_ICON.chat,
          what: t`Owlit stopped`,
          where: t`in “${title}”`,
          detail: broken.error || undefined,
          // The row only opens the chat, so a stray click never runs anything again
          open,
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
    // Only agents owlit would run: the one picked for chats and the one doing background work
    const used = new Set([selected, background].filter(Boolean))
    for (const c of connectors) {
      const problem = connectorProblem(c)
      if (!used.has(c.id) || !problem) continue
      const role = c.id === selected ? t`picked for chats` : t`picked for background work`
      out.push({
        key: `agent:${c.id}`,
        icon: KIND_ICON.agent,
        what: problemSentence(c) ?? "",
        where: problem === "error" && c.error ? `· ${c.error}` : `· ${role}`,
        open: { label: t`Manage agents`, run: () => openSettings("agents") },
      })
    }
    if (loginTask) {
      out.push({ key: "login", icon: LibraryIcon, what: t`Your library wants you to sign in`, where: t`to fetch PDFs`, open: { label: t`Library proxy`, run: () => openSettings("proxy") } })
    }
    const waitingPapers = Object.values(papers)
      .filter((p) => p.noPdf?.needs && !p.pdf)
      .sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0))
    for (const needs of ["check", "sign-in"] as const) {
      const group = waitingPapers.filter((p) => p.noPdf?.needs === needs)
      const what = (several: boolean) =>
        needs === "sign-in"
          ? several
            ? t`Publishers want you to sign in`
            : t`The publisher wants you to sign in`
          : several
            ? t`Publishers want a quick check`
            : t`The publisher wants a quick check`
      const label = needs === "sign-in" ? t`Sign in` : t`Check now`
      if (group.length <= 2) {
        for (const paper of group) {
          const cite = citationLabel(paper)
          out.push({ key: `paper:${paper.id}`, icon: KIND_ICON.paper, what: what(false), where: t`for ${cite}`, open: { label, run: () => navigate(`/library/${paper.id}?check=1`) } })
        }
        continue
      }
      // One line for many: the first two by name, then each publisher's page in turn
      const names = namesOf(group)
      out.push({
        key: `papers:${needs}`,
        icon: KIND_ICON.paper,
        what: what(true),
        where: t`for ${names}`,
        detail: group.map(citationLabel).join("\n"),
        open: {
          label,
          run: () => {
            useCheckQueue.getState().start(group.map((p) => p.id))
            navigate(`/library/${group[0].id}?check=1&queue=1`)
          },
        },
      })
    }
    return out
  }, [chats, streaming, connectors, selected, background, dismissed, papers, loginTask, navigate])
}

// "McDaniel & Einstein 2000, Nahum-Shani et al. 2016 and 5 more"
function namesOf(papers: Paper[]) {
  const named = papers.slice(0, 2).map(citationLabel).join(", ")
  return papers.length > 2 ? plural(papers.length - 2, { one: `${named} and # more`, other: `${named} and # more` }) : named
}

// The row as a screen reader hears it: "Owlit stopped in “Draft”: Open"
function rowLabel(w: Waiting) {
  const { what, where } = w
  const label = w.open.label
  return where ? t`${what} ${where}: ${label}` : t`${what}: ${label}`
}

export function WaitingOnYou() {
  const waiting = useWaiting()
  if (!waiting.length) return null
  return (
    <section aria-labelledby="waiting-label">
      <GroupLabel id="waiting-label">{t`Waiting on you`}</GroupLabel>
      <ul className="flex flex-col gap-0.5">
        {waiting.map((w) => (
          <li key={w.key} className="group/waiting relative flex min-h-9 items-center gap-2.5 rounded-md py-1 pr-2.5 pl-2.5 hover:bg-muted has-focus-key:bg-muted">
            {/* The row's own button lies under its words, so the Retry and Dismiss buttons inside stay
                buttons of their own rather than buttons in a button */}
            <button type="button" onClick={w.open.run} title={w.detail} aria-label={rowLabel(w)} className="absolute inset-0 rounded-md outline-none" />
            <w.icon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
            <p className="pointer-events-none min-w-0 flex-1 truncate text-sm">
              {w.what}
              {w.where && <span className="text-muted-foreground"> {w.where}</span>}
            </p>
            {w.dismiss && (
              // Leaving a broken reply as it is: a quiet way out, shown where the pointer or focus is
              <IconButton label={t`Dismiss`}onClick={w.dismiss} className="relative opacity-0 group-hover/waiting:opacity-100 focus-key:opacity-100">
                <XIcon />
              </IconButton>
            )}
            {w.action ? (
              <Button size="sm" variant="outline" onClick={w.action.run} className="relative -mr-1.5">
                {w.action.label}
              </Button>
            ) : (
              <span className="pointer-events-none flex shrink-0 items-center gap-0.5 text-detail text-muted-foreground group-hover/waiting:text-foreground">
                {w.open.label}
                <ChevronRightIcon className="size-3.5" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
