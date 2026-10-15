import { t } from "@lingui/core/macro"
import { useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import { AppSidebar } from "@/app/AppSidebar"
import { CommandPalette } from "@/app/CommandPalette"
import { ShortcutsDialog } from "@/app/ShortcutsDialog"
import { ImportDialog } from "@/features/library/components/ImportDialog"
import { useShortcutsShortcut } from "@/app/shortcuts"
import { matchNav } from "@/app/nav"
import { IconButton } from "@/components/icon-button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useControlsRoom } from "@/lib/window-frame"
import { Toaster } from "@/components/ui/sonner"
import { AgentAskBar } from "@/features/agent/AgentAskBar"
import { AgentPanel, AgentToggle } from "@/features/agent/AgentWindow"
import { useAgentAllowed, useAgentShortcut } from "@/features/agent/hooks"
import { useAgentWindow } from "@/features/agent/store"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { useSettingsShortcut } from "@/features/settings/hooks"
import { WelcomePage } from "@/features/welcome/WelcomePage"
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow"
import { useIntro } from "@/features/onboarding/store"
import { useSettings } from "@/features/settings/store"
import { TourOverlay } from "@/features/tour/TourOverlay"
import { isDesktop } from "@/lib/rpc"
import { useNeedsWelcome, useWorkspace } from "@/lib/workspace"
import { useChatNotifications } from "@/features/chat/use-notify"
import { useDigestNotices } from "@/features/library/digests"
// Serves workspace files to agents (ACP fs/*), so it is in place before any chat runs
import "@/features/docs/fs"

// Until a workspace is open the window shows the first-launch flow, on a machine where no workspace has
// opened yet, or else the welcome page; while the last one is still opening at launch it shows only the
// empty frame, so neither flashes past. The flow stays up while the workspace it chose is opening.
export function Shell() {
  const welcome = useNeedsWelcome()
  const waiting = useWorkspace((s) => isDesktop && !s.current && (!s.known || s.opening))
  const onboarded = useSettings((s) => s.view?.onboarded)
  // Once shown, the flow stays through the opening of the workspace it chose (onboarded turns true then)
  const [onboarding, setOnboarding] = useState(false)
  if (welcome && onboarded === false && !onboarding) setOnboarding(true)
  if (onboarding && (welcome || waiting)) return <OnboardingFlow />
  if (welcome) return onboarded === undefined ? <div className="app-drag h-svh bg-background" /> : <WelcomePage />
  if (waiting) return <div className="app-drag h-svh bg-sidebar" />
  return <AppShell />
}

function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const hasPanel = !!matchNav(pathname)?.panel
  // The user's open/closed preference for pages with a panel; pages without one always collapse to the icon rail
  const [panelOpen, setPanelOpen] = useState(true)
  // While the agent window is docked the list panel folds, so the page keeps its column
  const agentAllowed = useAgentAllowed()
  const docked = useAgentWindow((s) => s.stage === "open") && agentAllowed
  const listShown = useAgentWindow((s) => s.listShown)
  const panelWidth = useAgentWindow((s) => s.panelWidth)
  const setListShown = useAgentWindow((s) => s.setListShown)
  useAgentShortcut()
  useSettingsShortcut()
  useShortcutsShortcut()
  useChatNotifications()
  useDigestNotices()
  const controlsRoom = useControlsRoom((s) => s.room)

  return (
    <TooltipProvider>
      {/* The top bar and icon rail form the frame. One gap sets the sheet's distance from the window's
          right and bottom edges and the space around each 32px rail button, so the rail is 32px + 2 gaps. */}
      <div className="[--frame-gap:4px] [--header-height:2.5rem] [--rail-width:calc(2rem+2*var(--frame-gap))]">
        {/* The list panel shows and hides at once: no slide, so the page never moves under the reader */}
        <SidebarProvider
          className="h-svh flex-col bg-sidebar [&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none"
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
            <IconButton label={t`Back`} onClick={() => navigate(-1)}>
              <ArrowLeftIcon />
            </IconButton>
            <IconButton label={t`Forward`} onClick={() => navigate(1)}>
              <ArrowRightIcon />
            </IconButton>
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
        <SettingsDialog />
        <ShortcutsDialog />
        <ImportDialog />
        <TourOverlay />
        <IntroReplay />
        {/* Toasts move clear of the docked agent window so they never cover its composer */}
        <Toaster position="bottom-right" offset={docked ? { right: panelWidth + 20, bottom: 24 } : undefined} />
      </div>
    </TooltipProvider>
  )
}

// Help › How owlit works: the flow's introduction steps over the app
function IntroReplay() {
  const open = useIntro((s) => s.open)
  const close = useIntro((s) => s.close)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 animate-in fade-in duration-(--t-menu) ease-(--ease)">
      <OnboardingFlow mode="replay" onClose={close} />
    </div>
  )
}
