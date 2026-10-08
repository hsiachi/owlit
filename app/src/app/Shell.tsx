import { useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { AppSidebar } from "@/app/AppSidebar"
import { matchNav } from "@/app/nav"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

export function Shell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const hasPanel = !!matchNav(pathname)?.panel
  // The user's open/closed preference for pages with a panel; pages without one always collapse to the icon rail
  const [panelOpen, setPanelOpen] = useState(true)

  return (
    <TooltipProvider>
      {/* The top bar is as tall as the icon rail is wide; together they form the frame */}
      <div className="[--header-height:2.5rem]">
        <SidebarProvider
          className="h-svh flex-col bg-sidebar"
          open={hasPanel && panelOpen}
          onOpenChange={(open) => hasPanel && setPanelOpen(open)}
          style={
            {
              "--sidebar-width": "288px",
              "--sidebar-width-icon": "var(--header-height)",
            } as React.CSSProperties
          }
        >
          <header className="flex h-(--header-height) shrink-0 items-center gap-0.5 px-1.5 text-muted-foreground">
            <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)}>
              <ArrowLeft />
              <span className="sr-only">Back</span>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => navigate(1)}>
              <ArrowRight />
              <span className="sr-only">Forward</span>
            </Button>
            {hasPanel && <SidebarTrigger />}
          </header>
          <div className="flex min-h-0 flex-1">
            <AppSidebar />
            {/* Main area: a white sheet floating on the sidebar-coloured frame; the rail and list panel are the frame */}
            <SidebarInset className="mx-2 mb-2 min-h-0 overflow-hidden rounded-xl border shadow-xs">
              <div className="flex min-h-0 flex-1 flex-col">
                <Outlet />
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}
