import { t } from "@lingui/core/macro"
import { SearchIcon } from "lucide-react"
import { i18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { LIBRARY_PAPERS } from "./content"
import { useScript, words } from "./engine"
import { Layers, MiniComposer, PaperRow, Ring } from "./parts"
import { useDemoPlace } from "./place"
import s from "./demos.module.css"

// The same greeting the Chat page says (ChatEmpty), with the name as it is typed
function greeting(name: string) {
  const h = new Date().getHours()
  if (name) {
    if (h < 5) return t`Up late, ${name}`
    if (h < 12) return t`Good morning, ${name}`
    if (h < 18) return t`Good afternoon, ${name}`
    return t`Good evening, ${name}`
  }
  if (h < 5) return t`Up late`
  if (h < 12) return t`Good morning`
  if (h < 18) return t`Good afternoon`
  return t`Good evening`
}

// About you: Chat's greeting above its composer, following the name field as it is typed
export function GreetingDemo({ name, agentName }: { name: string; agentName: string }) {
  useDemoPlace("chat")
  return (
    <div className={s.greet}>
      {/* Set like the Chat page's greeting: Dosis slanted by a skew, Chinese upright */}
      <div className={cn(s.g, "font-display -skew-x-12 font-medium text-foreground/90 [&:lang(zh)]:skew-x-0")}>{greeting(name.trim())}</div>
      <MiniComposer placeholder={t`Ask about your papers, docs or notes…`} agentName={agentName} />
    </div>
  )
}

// Agent: Owlit says hello through the chosen agent, its words coming in as they would
export function HelloDemo({ name, agentName }: { name: string; agentName: string }) {
  useDemoPlace("chat")
  const who = name.trim()
  const hello = who
    ? t`Hi ${who}. I’m Owlit. I’ll work through ${agentName} on this Mac. Ask me about your papers, or hand me something longer, like finding papers or drafting a table.`
    : t`Hi. I’m Owlit. I’ll work through ${agentName} on this Mac. Ask me about your papers, or hand me something longer, like finding papers or drafting a table.`
  const said = words(hello, i18n.locale)
  const { layers } = useScript<{ words: number }>({
    initial: () => ({ words: 0 }),
    final: () => ({ words: said.length }),
    script: async (c) => {
      await c.sleep(500)
      for (let i = 1; i <= said.length; i++) {
        c.set({ words: i })
        await c.sleep(60)
      }
      await c.sleep(4000)
    },
    // A new name or agent starts the hello again
    restart: hello,
  })
  return (
    <Layers layers={layers}>
      {(st) => (
        <div className={s.hello}>
          <div className={s.bubble}>{t`Hi!`}</div>
          <div className={s.step}>
            <Ring done />
            <span>{t`Answered through ${agentName}`}</span>
          </div>
          <div className={s.ans}>
            {said.slice(0, st.words).map((w, i) => (
              <span key={i} className={s.wordIn}>
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
    </Layers>
  )
}

// Look: the Library, painted by the page's theme and paper tone as they are picked
export function LibraryPreview() {
  useDemoPlace("library")
  return (
    <div className={s.lookpage}>
      <div className={s.h}>{t`Library`}</div>
      <div className={s.find}>
        <SearchIcon />
        <span>{t`Search, or paste a DOI, arXiv id or link to add`}</span>
      </div>
      {LIBRARY_PAPERS.map((p) => (
        <PaperRow key={p.title} {...p} />
      ))}
    </div>
  )
}
