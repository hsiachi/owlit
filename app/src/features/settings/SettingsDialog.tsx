// Settings: one dialog over the app, a short list of sections on the left and one section on the right
// (the shape of shadcn's sidebar-13 block). Opened from ⌘, or the app menu, the gear at the bottom of
// the rail, and links where something could work better ("Set up library proxy", "Manage agents…"),
// which open it at their section. Closing it leaves you exactly where you were.

import { BotIcon, CircleUserIcon, EyeIcon, GlobeIcon, LandmarkIcon, PaletteIcon, ScanTextIcon, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar"
import { isBroken } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { useLoginTasks } from "@/features/tasks/store"
import { useFold } from "./form-state"
import { Info } from "@/components/info"
import { AgentsSection } from "./sections/AgentsSection"
import { AppearanceSection } from "./sections/AppearanceSection"
import { PrivacySection } from "./sections/PrivacySection"
import { ProfileSection } from "./sections/ProfileSection"
import { ProxySection } from "./sections/ProxySection"
import { ReadingSection } from "./sections/ReadingSection"
import { SourcesSection } from "./sections/SourcesSection"
import { closeSettings, SECTIONS, showSection, useSettings, type SettingsSection } from "./store"

// What each section shows besides its name: its icon in the list, what it is about, and its body
const PARTS: Record<SettingsSection, { icon: LucideIcon; about: string; body: React.ComponentType }> = {
  profile: {
    icon: CircleUserIcon,
    about: "Who you are to Owlit. It stays on this computer and is told only to the agent you chat with.",
    body: ProfileSection,
  },
  appearance: {
    icon: PaletteIcon,
    about: "How owlit looks on this computer. Stars, notes, tags and PDF highlights keep their colours in every tone, because the colour is what they mean.",
    body: AppearanceSection,
  },
  agents: {
    icon: BotIcon,
    about: "Coding agents installed on this computer, driven over the Agent Client Protocol. Each agent uses its own sign-in; owlit stores no keys for them.",
    body: AgentsSection,
  },
  sources: {
    icon: GlobeIcon,
    about: "Where owlit looks papers up. Everything works without these; they make lookups faster and fail less often.",
    body: SourcesSection,
  },
  proxy: {
    icon: LandmarkIcon,
    about: "Gets publisher PDFs through your university's subscription. owlit opens publisher pages through the proxy in its own browser window, signed in as you.",
    body: ProxySection,
  },
  reading: {
    icon: ScanTextIcon,
    about: "How owlit reads the text of a PDF, for search, highlights and Owlit's reading.",
    body: ReadingSection,
  },
  privacy: {
    icon: EyeIcon,
    about: "What owlit keeps about how you work. It stays in this workspace and is never sent anywhere.",
    body: PrivacySection,
  },
}
const LIST = SECTIONS.map((s) => ({ ...s, ...PARTS[s.id] }))

// A section shows a small dot in the list only while something in it needs the user
function useNeedsYou(): Partial<Record<SettingsSection, boolean>> {
  // An agent nobody has signed in to yet (the Owlit engine in Beta) isn't broken
  const agentBroken = useChatStore((s) => s.connectors.some(isBroken))
  const loginWaiting = useLoginTasks().length > 0
  return { agents: agentBroken, proxy: loginWaiting }
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open)
  const sectionId = useSettings((s) => s.section)
  const needs = useNeedsYou()
  const section = LIST.find((s) => s.id === sectionId) ?? LIST[0]
  const Body = section.body

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
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">This computer's settings for owlit.</DialogDescription>
        {/* Seven short names need about 200px; the rest goes to the section */}
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
                          <span>{s.label}</span>
                          {needs[s.id] && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" aria-label="Needs you" />}
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
              <h2 className="text-base font-medium">{section.label}</h2>
              <Info label={`About ${section.label}`}>{section.about}</Info>
            </header>
            <div className="flex-1 overflow-y-auto px-6 pt-1 pb-7">
              <Body key={section.id} />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
