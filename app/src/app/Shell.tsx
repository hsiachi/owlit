import { useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { AppSidebar } from "@/app/AppSidebar"
import { CommandPalette } from "@/app/CommandPalette"
import { matchNav } from "@/app/nav"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useControlsRoom } from "@/lib/window-frame"
import { Toaster } from "@/components/ui/sonner"
import { AgentAskBar, AgentPanel, AgentToggle } from "@/features/agent/AgentWindow"
import { useAgentAllowed, useAgentShortcut } from "@/features/agent/hooks"
import { useAgentWindow } from "@/features/agent/store"
// Serves workspace files to agents (ACP fs/*), so it is in place before any chat runs
import "@/features/docs/fs"
// Serves Knowledge to agents the same way
import "@/features/knowledge/agent"

export function Shell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const hasPanel = !!matchNav(pathname)?.panel
  // The user's open/closed preference for pages with a panel; pages without one always collapse to the icon rail
  const [panelOpen, setPanelOpen] = useState(true)
  // While the agent window is docked the list panel folds, so the page keeps its column
  const agentAllowed = useAgentAllowed()
  const docked = useAgentWindow((s) => s.stage === "open") && agentAllowed
  const listShown = useAgentWindow((s) => s.listShown)
  const setListShown = useAgentWindow((s) => s.setListShown)
  useAgentShortcut()
  const controlsRoom = useControlsRoom((s) => s.room)

  return (
    <TooltipProvider>
      {/* The top bar and icon rail form the frame. One gap sets the sheet's distance from the window's
          right and bottom edges and the space around each 32px rail button, so the rail is 32px + 2 gaps. */}
      <div className="[--frame-gap:4px] [--header-height:2.5rem] [--rail-width:calc(2rem+2*var(--frame-gap))]">
        <SidebarProvider
          className="h-svh flex-col bg-sidebar"
          open={hasPanel && panelOpen && (!docked || listShown)}
          onOpenChange={(open) => {
            if (!hasPanel) return
            if (docked) setListShown(open)
            else setPanelOpen(open)
          }}
          style={
            {
              "--sidebar-width": "300px",
              "--sidebar-width-icon": "var(--rail-width)",
            } as React.CSSProperties
          }
        >
          {/* The bar drags the window. Padding of gap + 2px puts the first 28px button on the same centre
              line as the rail icons; on macOS it starts after the traffic lights instead, except in full screen */}
          <header
            className="app-drag flex h-(--header-height) shrink-0 items-center gap-0.5 px-[calc(var(--frame-gap)+2px)] text-muted-foreground"
            style={controlsRoom ? { paddingLeft: controlsRoom } : undefined}
          >
            <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)}>
              <ArrowLeft />
              <span className="sr-only">Back</span>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => navigate(1)}>
              <ArrowRight />
              <span className="sr-only">Forward</span>
            </Button>
            {hasPanel && <SidebarTrigger />}
            <AgentToggle />
          </header>
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            {/* Main area: right half of one rounded sheet shared with the list panel; the whole sheet when collapsed */}
            <SidebarInset className="mr-(--frame-gap) mb-(--frame-gap) min-h-0 overflow-hidden rounded-r-lg border-y border-r md:peer-data-[state=collapsed]:rounded-l-lg md:peer-data-[state=collapsed]:border-l">
              <div className="flex min-h-0 flex-1">
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  <Outlet />
                  <AgentAskBar />
                </div>
                {docked && <AgentPanel />}
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
        <CommandPalette />
        {/* Toasts move clear of the docked agent window so they never cover its composer */}
        <Toaster position="bottom-right" offset={docked ? { right: 420, bottom: 24 } : undefined} />
      </div>
    </TooltipProvider>
  )
}
