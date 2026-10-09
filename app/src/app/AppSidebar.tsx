import * as React from "react"
import { NavLink, useLocation } from "react-router-dom"
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
import { SettingsIcon } from "lucide-react"
import { matchNav, nav } from "@/app/nav"
import { openSettings } from "@/features/settings/store"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { setOpen } = useSidebar()
  const activeItem = matchNav(pathname)

  return (
    <Sidebar
      collapsible="icon"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]! overflow-hidden pb-(--frame-gap) group-data-[side=left]:border-r-0 *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      {/* First column: the places, icons only; part of the frame with the top bar */}
      <Sidebar collapsible="none" className="w-(--sidebar-width-icon)!">
        <SidebarContent>
          <SidebarGroup className="px-(--frame-gap)">
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {nav.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      tooltip={{
                        children: item.label,
                        hidden: false,
                      }}
                      onClick={() => item.panel && setOpen(true)}
                      isActive={activeItem?.to === item.to}
                      className="px-2.5 md:px-2 data-active:bg-card data-active:shadow-xs dark:data-active:bg-card"
                    >
                      <NavLink to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {/* Settings opens over the page as a dialog, so its button sits apart from the places */}
        <SidebarFooter className="px-(--frame-gap) pb-0">
          <SidebarMenu>
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
          className="hidden w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]! shrink-0 rounded-l-lg border border-r-[0.5px] bg-sidebar-panel md:flex"
        >
          <activeItem.panel />
        </Sidebar>
      )}
    </Sidebar>
  )
}

function SettingsButton() {
  return (
    <SidebarMenuButton tooltip={{ children: "Settings", hidden: false }} onClick={() => openSettings()} className="px-2.5 md:px-2">
      <SettingsIcon />
      <span>Settings</span>
    </SidebarMenuButton>
  )
}
