import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpenIcon, BotIcon, LibraryIcon, MessageSquareIcon, ShieldAlertIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { needsSignIn } from "@/features/chat/lib/sign-in"
import { useChatStore } from "@/features/chat/store"
import { brokenReply, pendingPermission, useSeenStore } from "@/features/chat/status"
import { regenerate } from "@/features/chat/lib/regenerate"
import { toolTitle } from "@/features/chat/lib/tool-title"
import { useLibraryStore } from "@/features/library/store"
import { citationLabel } from "@/features/library/lib/format"
import { openSettings, useSettings } from "@/features/settings/store"
import { useTasksStore } from "@/features/tasks/store"

// Everything stuck on the user, in one list: a permission a chat waits for, a publisher that wants a
// check, handed-off work that broke, an agent that can't run, a library sign-in. Each line is the thing
// and its fix; it leaves once answered, and nothing is counted. Shown only while something waits. The
// places these come from keep their own marks (a chat's status ring, the rail's dots).
interface Waiting {
  key: string
  icon: typeof MessageSquareIcon
  what: string
  where?: string
  // The full story when the line is short for it, such as the agent's own error message
  detail?: string
  fix: { label: string; run: () => void; quiet?: boolean }
  // Leave it as it is: only for a broken reply, which otherwise waits until it is run again
  dismiss?: () => void
}

// A permission reads as what Owlit asks to do, not as a done action: "Owlit asks to edit untitled.md".
// Paths shorten to their file name; a title that doesn't start with a plain verb is quoted as it is.
const VERBS = /^(edit|write|create|read|delete|move|rename|run|fetch|open|search|save|update|add|list|look|leave|highlight|show)\b/i
function askedAction(title: string) {
  const action = title.replace(/(?:[\w.~-]*\/)+([\w.-]+)/g, "$1")
  if (!VERBS.test(action)) return `Owlit asks for permission: ${action}`
  return `Owlit asks to ${action.charAt(0).toLowerCase()}${action.slice(1)}`
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
  const loginTask = useTasksStore((s) => Object.values(s.byId).find((t) => t.state === "waiting_for_you" && t.waiting?.reason === "login"))

  return useMemo(() => {
    const out: Waiting[] = []
    for (const chat of Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const permission = streaming[chat.id] ? pendingPermission(chat) : undefined
      const broken = streaming[chat.id] ? undefined : brokenReply(chat, dismissed[chat.id])
      if (permission) {
        // Owlit's own tools and a paper's note are named in words first ("Search for papers")
        out.push({ key: `perm:${chat.id}`, icon: MessageSquareIcon, what: askedAction(toolTitle(permission.title)), where: `in “${chat.title}”`, fix: { label: "Open", run: () => navigate(`/chat/${chat.id}`) } })
      } else if (broken) {
        const index = chat.messages.length - 1
        out.push({
          key: `fail:${chat.id}`,
          icon: MessageSquareIcon,
          what: "Owlit stopped",
          where: `in “${chat.title}”`,
          detail: broken.error || undefined,
          fix: {
            label: "Retry",
            run: () => {
              navigate(`/chat/${chat.id}`)
              regenerate(chat.id, index)
            },
          },
          dismiss: () => useSeenStore.getState().dismiss(chat.id, broken.id),
        })
      }
    }
    for (const paper of Object.values(papers)) {
      const needs = paper.noPdf?.needs
      if (!needs) continue
      out.push({
        key: `paper:${paper.id}`,
        icon: BookOpenIcon,
        what: needs === "sign-in" ? "The publisher wants you to sign in" : "The publisher wants a quick check",
        where: `for ${citationLabel(paper)}`,
        fix: { label: needs === "sign-in" ? "Sign in" : "Check now", run: () => navigate(`/library/${paper.id}?check=1`) },
      })
    }
    // Only agents owlit would run: the one picked for chats and the one doing background work
    const used = new Set([selected, background].filter(Boolean))
    for (const c of connectors) {
      if (!used.has(c.id) || (c.status !== "not_installed" && c.status !== "error")) continue
      const role = c.id === selected ? "picked for chats" : "picked for background work"
      out.push({
        key: `agent:${c.id}`,
        icon: BotIcon,
        what: c.status === "not_installed" ? `${c.name} isn’t installed` : needsSignIn(c) ? `${c.name} isn’t signed in` : `${c.name} can’t run`,
        where: c.status === "error" && c.error && !needsSignIn(c) ? `· ${c.error}` : `· ${role}`,
        fix: { label: "Manage agents…", run: () => openSettings("agents"), quiet: true },
      })
    }
    if (loginTask) {
      out.push({ key: "login", icon: LibraryIcon, what: "Your library wants you to sign in", where: "to fetch PDFs", fix: { label: "Library proxy…", run: () => openSettings("proxy"), quiet: true } })
    }
    return out
  }, [chats, streaming, connectors, selected, background, dismissed, papers, loginTask, navigate])
}

export function WaitingOnYou() {
  const waiting = useWaiting()
  if (!waiting.length) return null
  return (
    <section aria-labelledby="waiting-label">
      <h2 id="waiting-label" className="flex items-center gap-1.5 px-2.5 pb-1.5 text-xs font-normal text-muted-foreground">
        <ShieldAlertIcon className="size-3.5 text-warning" />
        Waiting on you
      </h2>
      <ul className="divide-y overflow-hidden rounded-[10px] border bg-card">
        {waiting.map((w) => (
          <li key={w.key} className="group/waiting flex min-h-11 items-center gap-2.5 py-1.5 pr-2 pl-3">
            <w.icon className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 truncate text-sm" title={w.detail}>
              {w.what}
              {w.where && <span className="text-muted-foreground"> {w.where}</span>}
            </p>
            {w.dismiss && (
              // Leaving a broken reply as it is: a quiet way out, shown where the pointer or focus is
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Dismiss"
                    onClick={w.dismiss}
                    className="text-muted-foreground opacity-0 group-hover/waiting:opacity-100 focus-key:opacity-100"
                  >
                    <XIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            )}
            <Button size="sm" variant={w.fix.quiet ? "ghost" : "outline"} onClick={w.fix.run} className={w.fix.quiet ? "text-muted-foreground" : undefined}>
              {w.fix.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
