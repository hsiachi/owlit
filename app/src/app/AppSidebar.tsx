import { t } from "@lingui/core/macro"
import * as React from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CircleHelpIcon, SettingsIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { askOwlitHowTo } from "@/features/agent/store"
import { showIntro } from "@/features/onboarding/store"
import { takeTour } from "@/features/tour/take"
import { openShortcuts } from "@/app/shortcuts"
import { matchNav, nav } from "@/app/nav"
import { i18n } from "@/lib/i18n"
import { TipLabel } from "@/components/tip"
import { openSettings } from "@/features/settings/store"
import { useWaitingOnYou } from "@/app/waiting-on-you"
import { LIST_WIDTH, useListPanel } from "@/app/list-panel"
import { PanelResizeHandle } from "@/components/panel-resize-handle"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { setOpen } = useSidebar()
  const activeItem = matchNav(pathname)
  // A place's one mark: the first thing waiting there (app/waiting-on-you.ts), amber, or Owlit's dot for a
  // reply finished while the user wasn't looking at its chat. Work at its own pace isn't on that list.
  const waiting = useWaitingOnYou()
  const markOf = (to: string) => waiting.find((w) => w.place === to)
  const listWidth = useListPanel((s) => s.width)
  const setListWidth = useListPanel((s) => s.setWidth)

  // The sidebar clips only while collapsed (the list panel keeps its width behind the rail); open, the list
  // panel's resize edge reaches past its border into the page
  return (
    <Sidebar
      collapsible="icon"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]! pb-(--frame-gap) group-data-[state=collapsed]:overflow-hidden group-data-[side=left]:border-r-0 *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      {/* First column: the places, icons only; part of the frame with the top bar */}
      <Sidebar collapsible="none" className="w-(--sidebar-width-icon)!">
        <SidebarContent>
          <SidebarGroup className="px-(--frame-gap)">
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {nav.map((item) => {
                  const mark = markOf(item.to)
                  const needsYou = mark?.what
                  const place = i18n._(item.label)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        tooltip={{
                          children: needsYou ? t({ message: `${place} · ${needsYou}`, comment: "a place in the rail, then what waits there: Library · Sign in to your library" }) : place,
                          hidden: false,
                        }}
                        onClick={() => item.panel && setOpen(true)}
                        isActive={activeItem?.to === item.to}
                        className="px-2.5 md:px-2 data-active:bg-card data-active:shadow-xs dark:data-active:bg-card"
                      >
                        <NavLink to={item.to} className="relative">
                          <item.icon />
                          <span>{place}</span>
                          {mark && <span aria-hidden className={`absolute top-1.5 right-1.5 size-1.5 rounded-full ${mark.tone === "warning" ? "bg-warning" : "bg-owlit-mark"}`} />}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {/* Settings opens over the page as a dialog, so its button sits apart from the places */}
        <SidebarFooter className="px-(--frame-gap) pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <HelpButton />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SettingsButton />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Second column: the current place's list; left half of the sheet, lightly tinted and divided from the
          main area by its border. Fixed width (not flex-1) so collapsing clips it instead of squeezing its
          content, as in the official sidebar-09 block. */}
      {activeItem?.panel && (
        <Sidebar
          collapsible="none"
          className="relative hidden w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]! shrink-0 rounded-l-lg border border-r-[0.5px] bg-sidebar-panel md:flex"
        >
          <activeItem.panel />
          <PanelResizeHandle edge="right" label={t`Resize the list`} width={listWidth} setWidth={setListWidth} defaultWidth={LIST_WIDTH} />
        </Sidebar>
      )}
    </Sidebar>
  )
}

// Help, beside Settings at the rail's foot: the tour, the introduction again, every shortcut, or Owlit
// answering how to do something. The menu bar's Help menu has the same.
function HelpButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton data-tour="help" tooltip={{ children: <TipLabel label={t`Help`} />, hidden: false }} className="px-2.5 md:px-2">
          <CircleHelpIcon />
          <span>{t`Help`}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-52">
        <DropdownMenuItem onSelect={takeTour}>{t`Take the tour`}</DropdownMenuItem>
        <DropdownMenuItem onSelect={showIntro}>{t`How owlit works`}</DropdownMenuItem>
        <DropdownMenuItem onSelect={openShortcuts}>{t`Keyboard shortcuts`}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => askOwlitHowTo(pathname, navigate)}>{t`Ask Owlit how to…`}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SettingsButton() {
  return (
    <SidebarMenuButton
      tooltip={{ children: <TipLabel label={t`Settings`} shortcut="settings" />, hidden: false }}
      onClick={() => openSettings()}
      className="px-2.5 md:px-2"
    >
      <SettingsIcon />
      <span>{t`Settings`}</span>
    </SidebarMenuButton>
  )
}
