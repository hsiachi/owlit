import { t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { CheckIcon } from "lucide-react"
import { type Chat, type Mentionable, parentPath, parseOwlitUri, type Project, projectKey } from "@owlit/protocol"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { projectAt, projectChoices, useProjects } from "@/features/projects/store"
import { useThreadsStore } from "@/features/threads/store"
import { rpc } from "@/lib/rpc"
import { settled } from "../../disk"
import { useChatStore } from "../../store"

// The chat's projects as core works them out (the one the person put it in, then those of what it
// touched), asked again whenever that can have changed: the marks, the chat's project, a message sent, a
// turn ending (its writes count)
function useChatProjects(chat: Chat): Project[] {
  const projects = useProjects()
  const streaming = useChatStore((s) => !!s.streaming[chat.id])
  const [found, setFound] = useState<Project[]>([])
  const asked = `${chat.id}|${chat.project ?? ""}|${chat.messages.length}|${streaming}`
  useEffect(() => {
    let live = true
    // The chat's own change goes to core in its queue: asked once it is there
    void settled()
      .then(() => rpc.projects.ofChat({ chatId: chat.id }))
      .then((r) => live && setFound(r.projects))
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, projects])
  return found
}

// The marked folder nearest above a workspace path
function nearest(projects: Project[], rel: string) {
  for (let p = rel; p; p = parentPath(p)) {
    const project = projectAt(projects, p)
    if (project) return project
  }
  return undefined
}

// Above the composer of a chat in a workspace with projects: which project the chat is in, quietly, so a
// chat about one piece of work that touched none of its docs can be put in it once (Owlit then hears that
// project's lines and files its readings there). The page beside the panel counts as the next message
// will. A menu either way, with the project the person chose checked.
export function ProjectChip({ chat, context = [] }: { chat: Chat; context?: Mentionable[] }) {
  const projects = useProjects()
  const threads = useThreadsStore((s) => s.threads)
  const found = useChatProjects(chat)
  const beside = context.flatMap((c) => {
    const u = parseOwlitUri(c.uri)
    const project = u?.kind === "doc" ? nearest(projects, u.path) : u?.kind === "thread" ? projectAt(projects, threads[u.id]?.project ?? "") : undefined
    return project ? [project] : []
  })
  const shown = [...found, ...beside].filter((p, i, all) => all.findIndex((q) => q.path === p.path) === i)
  const chosen = projectAt(projects, chat.project ?? "")
  const choose = (project: Project | undefined) => useChatStore.getState().setChatProject(chat.id, project?.path)
  const names = projectChoices(shown)
    .map((c) => c.label)
    .join(t({ message: ", ", context: "between things in a list" }))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          className="inline-flex h-6 max-w-full min-w-0 items-center rounded-md bg-muted px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-key:text-foreground data-[state=open]:text-foreground"
        >
          <span className="min-w-0 truncate">
            {shown.length
              ? t({ message: `in: ${names}`, comment: "above the composer: the project(s) this chat is in, by name" })
              : t({ message: "in: —", comment: "above the composer: this chat is in no project; opens a menu to put it in one" })}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-40 max-w-80">
        {projectChoices(projects).map(({ project, label }) => (
          <DropdownMenuItem key={project.path} onSelect={() => projectKey(project.path) !== projectKey(chosen?.path) && choose(project)}>
            <span className="flex-1 truncate">{label}</span>
            {chosen === project && <CheckIcon className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => chat.project && choose(undefined)}>
          <span className="flex-1 truncate">{t({ message: "No project", comment: "a thread or chat in no project" })}</span>
          {!chosen && !shown.length && <CheckIcon className="text-muted-foreground" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
