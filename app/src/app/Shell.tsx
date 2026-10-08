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
      {/* The top bar and icon rail form the frame. One gap sets the sheet's distance from the window's
          right and bottom edges and the space around each 32px rail button, so the rail is 32px + 2 gaps. */}
      <div className="[--frame-gap:4px] [--header-height:2.5rem] [--rail-width:calc(2rem+2*var(--frame-gap))]">
        <SidebarProvider
          className="h-svh flex-col bg-sidebar"
          open={hasPanel && panelOpen}
          onOpenChange={(open) => hasPanel && setPanelOpen(open)}
          style={
            {
              "--sidebar-width": "300px",
              "--sidebar-width-icon": "var(--rail-width)",
            } as React.CSSProperties
          }
        >
          {/* Padding of gap + 2px puts the first 28px button on the same centre line as the rail icons */}
          <header className="flex h-(--header-height) shrink-0 items-center gap-0.5 px-[calc(var(--frame-gap)+2px)] text-muted-foreground">
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
            {/* Main area: right half of one rounded sheet shared with the list panel; the whole sheet when collapsed */}
            <SidebarInset className="mr-(--frame-gap) mb-(--frame-gap) min-h-0 overflow-hidden rounded-r-lg border-y border-r md:peer-data-[state=collapsed]:rounded-l-lg md:peer-data-[state=collapsed]:border-l">
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
