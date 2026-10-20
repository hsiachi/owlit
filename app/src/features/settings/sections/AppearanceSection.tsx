import { t } from "@lingui/core/macro"
import type { InterfaceLanguage, PaperTone, ThemeChoice } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { SegmentedControl } from "@/components/segmented-control"
import { Switch } from "@/components/ui/switch"
import { List, Picker, Row } from "../parts"
import { appearanceOf, updateSettings, useSettings } from "../store"

const themes = (): { value: ThemeChoice; label: string }[] => [
  { value: "system", label: t`System` },
  { value: "light", label: t`Light` },
  { value: "dark", label: t`Dark` },
]

const tones = (): { value: PaperTone; label: string }[] => [
  { value: "warm", label: t`Warm` },
  { value: "slate", label: t`Slate` },
  { value: "sepia", label: t`Sepia` },
]

// Each language by its own name, as every system's language list shows them, so someone who can't read
// the current one still finds theirs. The pseudo language checks for untranslated words in development.
const languages = (): { value: InterfaceLanguage; label: string }[] => [
  { value: "system", label: t`System` },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  ...(import.meta.env.DEV ? [{ value: "pseudo" as const, label: "Pseudo" }] : []),
]

// The interface's language; also asked in the first launch's About you, so a reader who doesn't read the
// system's language finds theirs before the steps that need reading
export function InterfaceLanguageRow() {
  const { language } = useSettings((s) => appearanceOf(s.view))
  return <Row name={t`Language`} control={<Picker label={t`Language`} value={language} options={languages()} onChange={(value) => void updateSettings({ appearance: { language: value } })} />} />
}

export function AppearanceSection() {
  const { theme, tone, dimPdf = true } = useSettings((s) => appearanceOf(s.view))
  return (
    <List>
      <InterfaceLanguageRow />
      <Row
        name={t`Theme`}
        control={
          <SegmentedControl label={t`Theme`} value={theme} options={themes()} onChange={(value) => void updateSettings({ appearance: { theme: value } })} />
        }
      />
      <div className="pt-3 pb-4">
        <div className="text-sm">{t`Paper tone`}</div>
        <div role="radiogroup" aria-label={t`Paper tone`} className="mt-3 grid grid-cols-3 gap-3">
          {tones().map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={tone === o.value}
              onClick={() => void updateSettings({ appearance: { tone: o.value } })}
              className={cn("group/tone flex flex-col items-center gap-2 text-detail text-muted-foreground outline-none", tone === o.value && "font-medium text-foreground")}
            >
              <TonePreview tone={o.value} selected={tone === o.value} />
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <Row
        name={t`Dim PDF pages in the dark theme`}
        help={t`Pages stay white in both themes; dimmed, they don't glare beside the dark panels.`}
        control={<Switch checked={dimPdf} onCheckedChange={(on) => void updateSettings({ appearance: { dimPdf: on } })} aria-label={t`Dim PDF pages in the dark theme`} />}
      />
    </List>
  )
}

// A small picture of the app in a tone: frame, list panel and sheet, drawn with that tone's own tokens
// (index.css applies a tone to any element carrying data-tone)
function TonePreview({ tone, selected }: { tone: PaperTone; selected: boolean }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "grid aspect-[4/3] w-full grid-cols-[16%_30%_1fr] gap-[3px] overflow-hidden rounded-lg bg-sidebar p-[3px] ring-1 ring-border transition-shadow group-hover/tone:ring-foreground/25 group-focus-key/tone:ring-2 group-focus-key/tone:ring-ring",
        selected && "ring-2 ring-foreground group-hover/tone:ring-foreground",
      )}
    >
      <span className="rounded-[4px] bg-sidebar" />
      <span className="relative rounded-[4px] bg-sidebar-panel">
        <span className="absolute inset-x-[12%] top-[20%] h-2 rounded-[3px] bg-sidebar-accent" />
      </span>
      <span className="relative rounded-[4px] bg-background">
        <span className="absolute top-[20%] left-[12%] h-[5px] w-[46%] rounded-full bg-foreground" />
        <span className="absolute top-[38%] left-[12%] h-[5px] w-[70%] rounded-full bg-muted-foreground/50" />
      </span>
    </span>
  )
}
