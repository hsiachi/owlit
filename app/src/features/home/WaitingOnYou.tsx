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
import { continueLabel, getInBrowser, showBrowser, stoppedLine, useFromBrowserRun, useStoppedOn, useWaitingForBrowser } from "@/features/library/from-browser"
import { useLibraryUi } from "@/features/library/ui-store"
import { citationLabel } from "@/features/library/lib/format"
import type { Paper } from "@/features/library/types"
import { openSettings, useSettings } from "@/features/settings/store"
import { cancelTask, resumeTask, useTasksStore } from "@/features/tasks/store"
import { importAsks, useImports } from "@/features/library/imports"
import { importOrigin } from "@/features/library/components/ImportBanner"

// Everything stuck on the user, in one list: a permission a chat waits for, papers only their browser
// can get, handed-off work that broke, an agent that can't run. Each line is the thing
// and its fix; it leaves once answered. The whole row is the way to the fix, as every row on Home is a
// link, and its right end says what clicking does ("Open ›"); a real button is kept only for a fix
// that does something other than going there (Retry, Get them). Shown only while something waits, in the rows' own look (Home's
// Recent), not a card. The places these come from keep their own marks (a chat's status ring, the rail's
// dots). What holds up work comes first: a chat or an agent stopped on the user. A missing PDF only
// keeps a paper away, so papers come last, in one line.
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
  const imports = useImports((s) => s.list)
  const tasks = useTasksStore((s) => s.byId)
  const fromBrowser = useFromBrowserRun()
  const stoppedOn = useStoppedOn()
  const waiting = useWaitingForBrowser()

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
    // An import started from the CLI stops to ask about MinerU; the Library's line has the answers
    for (const i of imports) {
      const task = tasks[i.taskId]
      if (!task || !importAsks(task)) continue
      const origin = importOrigin(i)
      out.push({ key: `import:${i.id}`, icon: LibraryIcon, what: t`An import asks about MinerU`, where: origin, open: { label: t`Answer`, run: () => navigate("/library") } })
    }
    // Papers owlit couldn't get alone wait for the user's own browser: one line whose button gets them
    // there in turn. While that runs, the line says how far it has got; stopped on the user, what their
    // browser may be asking, with the browser one click away. Papers whose page was opened there wait
    // for the user to save the PDF, on a line of their own.
    const forBrowser = Object.values(papers)
      .filter((p) => !p.pdf && p.noPdf?.needs === "browser")
      .sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0))
    const browser = forBrowser.find((p) => p.noPdf?.fromBrowser?.browser)?.noPdf?.fromBrowser?.browser
    const pages = forBrowser.filter((p) => p.noPdf?.fromBrowser?.state === "page")
    const show = { label: t`Show browser`, run: () => void showBrowser(stoppedOn?.id) }
    if (fromBrowser) {
      const done = fromBrowser.progress?.done ?? 0
      const total = fromBrowser.progress?.total ?? done
      if (fromBrowser.state === "waiting_for_you") {
        out.push({
          key: "papers:from-browser",
          icon: KIND_ICON.paper,
          what: stoppedLine(stoppedOn),
          where: t`· getting PDFs, ${done} of ${total}`,
          detail: fromBrowser.waiting?.detail,
          open: show,
          action: { label: continueLabel(stoppedOn), run: () => void resumeTask(fromBrowser.id) },
        })
      } else {
        out.push({
          key: "papers:from-browser",
          icon: KIND_ICON.paper,
          what: t`Getting PDFs in your browser`,
          where: t`· ${done} of ${total}`,
          open: show,
          action: { label: t({ message: "Stop", comment: "stop getting PDFs from the browser" }), run: () => void cancelTask(fromBrowser.id) },
        })
      }
    } else if (waiting.length) {
      const one = waiting.length === 1
      out.push({
        key: "papers:browser",
        icon: KIND_ICON.paper,
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
        key: "papers:pages",
        icon: KIND_ICON.paper,
        what: browser
          ? plural(n, { one: `Save the PDF from the page open in ${browser}`, other: `Save # PDFs from the pages open in ${browser}` })
          : plural(n, { one: "Save the PDF from the page open in your browser", other: "Save # PDFs from the pages open in your browser" }),
        where: namesOf(pages),
        open: show,
      })
    }
    return out
  }, [chats, streaming, connectors, selected, background, dismissed, papers, imports, tasks, fromBrowser, stoppedOn, waiting, navigate])
}

// "for McDaniel & Einstein 2000, Nahum-Shani et al. 2016": one or two papers by name. More are only
// counted in the row's words: two names picked from many say nothing, and Show them lists them all with
// their titles (a hover list of authors and years didn't either)
function namesOf(papers: Paper[]) {
  if (papers.length > 2) return undefined
  const names = papers.map(citationLabel).join(", ")
  return t`for ${names}`
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
