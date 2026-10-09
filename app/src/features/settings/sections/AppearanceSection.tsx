import type { PaperTone, ThemeChoice } from "@owlit/protocol"
import { cn } from "cn"
import { List, Row } from "../parts"
import { appearanceOf, updateSettings, useSettings } from "../store"

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const TONES: { value: PaperTone; label: string }[] = [
  { value: "warm", label: "Warm" },
  { value: "neutral", label: "Neutral" },
  { value: "slate", label: "Slate" },
  { value: "sepia", label: "Sepia" },
]

export function AppearanceSection() {
  const { theme, tone } = useSettings((s) => appearanceOf(s.view))
  return (
    <List>
      <Row
        name="Theme"
        control={
          <div role="radiogroup" aria-label="Theme" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={theme === t.value}
                onClick={() => void updateSettings({ appearance: { theme: t.value } })}
                className={cn(
                  "h-6 rounded-md px-3 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50",
                  theme === t.value && "bg-card text-foreground shadow-xs",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-3.5 pt-3 pb-3.5">
        <div className="text-sm">Paper tone</div>
        <div role="radiogroup" aria-label="Paper tone" className="mt-3 grid grid-cols-4 gap-3">
          {TONES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={tone === t.value}
              onClick={() => void updateSettings({ appearance: { tone: t.value } })}
              className={cn("group/tone flex flex-col items-center gap-2 text-[13px] text-muted-foreground outline-none", tone === t.value && "font-medium text-foreground")}
            >
              <TonePreview tone={t.value} selected={tone === t.value} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
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
        "grid aspect-[4/3] w-full grid-cols-[16%_30%_1fr] gap-[3px] overflow-hidden rounded-lg bg-sidebar p-[3px] ring-1 ring-border transition-shadow group-hover/tone:ring-foreground/25 group-focus-visible/tone:ring-2 group-focus-visible/tone:ring-ring",
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
