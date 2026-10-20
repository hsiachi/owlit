import { useState } from "react"
import { t } from "@lingui/core/macro"
import type { WorkspaceInfo } from "@owlit/protocol"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { openNewWorkspace } from "@/features/welcome/NewWorkspaceDialog"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { pickWorkspaceFolder, switchWorkspace, useWorkspace } from "@/lib/workspace"

// The open workspace's name in the top bar, muted, so which folder this is shows on every page (the
// window's own title bar is hidden); it opens the File menu's Open Recent, with New and Open after it
export function WorkspaceMenu() {
  const current = useWorkspace((s) => s.current)
  const navigate = useNavigate()
  const [recent, setRecent] = useState<WorkspaceInfo[] | null>(null)
  if (!current) return null
  const others = recent?.filter((w) => w.path !== current.path) ?? []
  // Home first, after the open workspace's writes are flushed: the page showing now belongs to it
  const open = (path: string) =>
    switchWorkspace(async () => {
      navigate("/")
      return rpc.workspace.open({ path })
    }).catch(toastError)
  const openFolder = async () => {
    const folder = await pickWorkspaceFolder()
    if (folder) await open(folder)
  }
  return (
    <DropdownMenu onOpenChange={(o) => o && void rpc.workspace.recent().then(setRecent, () => setRecent([]))}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 max-w-56 min-w-0 px-2 font-normal text-muted-foreground" title={current.path}>
          <span className="truncate">{current.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t`Open Recent`}</DropdownMenuLabel>
        {others.map((w) => (
          <DropdownMenuItem key={w.path} title={w.path} onSelect={() => void open(w.path)}>
            <span className="truncate">{w.name}</span>
          </DropdownMenuItem>
        ))}
        {recent && !others.length && <DropdownMenuItem disabled>{t`No other workspaces`}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openNewWorkspace}>{t`New Workspace…`}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openFolder()}>{t`Open Workspace…`}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
