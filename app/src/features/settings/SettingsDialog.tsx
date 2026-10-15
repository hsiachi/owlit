// Settings: one dialog over the app, a short list of sections on the left and one section on the right
// (the shape of shadcn's sidebar-13 block). Opened from ⌘, or the app menu, the gear at the bottom of
// the rail, and links where something could work better ("Set up library proxy", "Manage agents…"),
// which open it at their section. Closing it leaves you exactly where you were.

import { msg, t } from "@lingui/core/macro"
import type { MessageDescriptor } from "@lingui/core"
import { useEffect, useRef } from "react"
import { BotIcon, PaletteIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar"
import { WaitingDot } from "@/components/marks"
import { OwlitMark } from "@/components/owlit-mark"
import { isBroken } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { i18n } from "@/lib/i18n"
import { KIND_ICON } from "@/lib/kinds"
import { useFold } from "./form-state"
import { Info } from "@/components/info"
import { AgentsSection } from "./sections/AgentsSection"
import { AppearanceSection } from "./sections/AppearanceSection"
import { OwlitSection } from "./sections/OwlitSection"
import { PapersSection } from "./sections/PapersSection"
import { closeSettings, SECTIONS, showSection, useSettings, type SettingsSection } from "./store"

// What each section shows besides its name: its icon in the list, what it is about, and its body
const PARTS: Record<SettingsSection, { icon: React.ComponentType; about: MessageDescriptor; body: React.ComponentType }> = {
  owlit: {
    icon: OwlitMark,
    about: msg`What Owlit calls you, the work it does when nobody is waiting, and what it remembers. Your name is told only to the agent you chat with.`,
    body: OwlitSection,
  },
  agents: {
    icon: BotIcon,
    about: msg`Coding agents installed on this computer, driven over the Agent Client Protocol. Each agent uses its own sign-in; owlit stores no keys for them.`,
    body: AgentsSection,
  },
  papers: {
    icon: KIND_ICON.paper,
    about: msg`How owlit finds papers, gets their PDFs and reads their text. Everything here is optional; it makes those work better.`,
    body: PapersSection,
  },
  appearance: {
    icon: PaletteIcon,
    about: msg`How owlit looks on this computer. Stars, notes, tags and PDF highlights keep their colours in every tone, because the colour is what they mean.`,
    body: AppearanceSection,
  },
}
const LIST = SECTIONS.map((s) => ({ ...s, ...PARTS[s.id] }))

// A section shows a small dot in the list only while something in it needs the user
function useNeedsYou(): Partial<Record<SettingsSection, boolean>> {
  // An agent nobody has signed in to yet (the Owlit engine in Beta) isn't broken
  const agentBroken = useChatStore((s) => s.connectors.some(isBroken))
  return { agents: agentBroken }
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open)
  const sectionId = useSettings((s) => s.section)
  const needs = useNeedsYou()
  const section = LIST.find((s) => s.id === sectionId) ?? LIST[0]
  const Body = section.body
  const sectionLabel = i18n._(section.label)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSettings()}>
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[580px] md:max-w-[760px] lg:max-w-[800px]"
        // Focus the dialog itself rather than its first control, so no tooltip pops open on arrival
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
        // Esc folds an open form before it closes the dialog
        onEscapeKeyDown={(e) => {
          const { fold } = useFold.getState()
          if (fold) {
            e.preventDefault()
            fold()
          }
        }}
      >
        <DialogTitle className="sr-only">{t`Settings`}</DialogTitle>
        <DialogDescription className="sr-only">{t`This computer's settings for owlit.`}</DialogDescription>
        {/* The list keeps the width it had with seven names, so the section column stays the same */}
        <SidebarProvider className="min-h-0 items-start" style={{ "--sidebar-width": "12.5rem" } as React.CSSProperties}>
          <Sidebar collapsible="none" className="hidden h-[560px] border-r bg-sidebar-panel md:flex">
            <SidebarContent>
              {/* The first name sits on the section title's middle line */}
              <SidebarGroup className="pt-3">
                <SidebarGroupContent>
                  {/* A list you pick from, not a menu: rows sit 2px apart so the chosen row and a hovered one never merge */}
                  <SidebarMenu className="gap-0.5">
                    {LIST.map((s) => (
                      <SidebarMenuItem key={s.id}>
                        <SidebarMenuButton isActive={s.id === section.id} onClick={() => showSection(s.id)}>
                          <s.icon />
                          <span>{i18n._(s.label)}</span>
                          {needs[s.id] && <WaitingDot className="ml-auto size-1.5" label={t`Needs you`} />}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[560px] min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-1 pr-12 pl-6">
              <h2 className="text-base font-medium">{sectionLabel}</h2>
              <Info label={t`About ${sectionLabel}`}>{i18n._(section.about)}</Info>
            </header>
            <div className="flex-1 overflow-y-auto px-6 pt-1 pb-7">
              <Body key={section.id} />
              <ShowGroup />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

// A link that names a group ("Set up library proxy") brings it to the top. It sits after the section's
// body, inside the dialog's portal, so the group is on the page by the time its effect runs.
function ShowGroup() {
  const group = useSettings((s) => s.group)
  const mark = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!group) return
    mark.current?.parentElement?.querySelector(`[data-settings-group="${group}"]`)?.scrollIntoView({ block: "start" })
    useSettings.setState({ group: null })
  }, [group])
  return <span ref={mark} hidden />
}
