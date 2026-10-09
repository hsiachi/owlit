import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronRightIcon, EllipsisVerticalIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { NoteDot } from "../components/bits"
import { TopicMenuContent } from "../components/TopicMenu"
import { ago, shortDate, thisWeek } from "../lib/when"
import { changedSince, renameTopic, useKnowledgeStore, useTopics } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"

// A run counts as recent for this long; after that the page says nothing about runs
const RECENT_MS = 48 * 3_600_000
// The find field appears once the list is longer than a screen
const FIND_FROM = 9

// Scrolls the whole page, in the Library's one wide column
export function KnowledgeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className="mx-auto w-full max-w-6xl px-6 pt-10 pb-24">{children}</div>
    </div>
  )
}

const matches = (t: Topic, words: string[]) => {
  const hay = [t.name, t.summary, ...t.lines.map((l) => l.text), ...t.questions.map((q) => q.text)].join(" ").toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function KnowledgePage() {
  const topics = useTopics()
  const loose = useKnowledgeStore((s) => s.loose)
  const query = useKnowledgeUi((s) => s.query)
  const [asideOpen, setAsideOpen] = useState(false)

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = useMemo(() => topics.filter((t) => matches(t, query.toLowerCase().split(/\s+/).filter(Boolean))), [topics, query])
  const live = shown.filter((t) => !t.archived)
  const groups = [
    { label: "This week", topics: live.filter((t) => thisWeek(t.updatedAt)) },
    { label: "Earlier", topics: live.filter((t) => !thisWeek(t.updatedAt)) },
  ].filter((g) => g.topics.length)
  const archived = shown.filter((t) => t.archived)
  const looseHit = words.length > 0 && loose.some((l) => words.every((w) => l.quote.toLowerCase().includes(w)))
  const aside = [archived.length > 0 && `${archived.length} archived`, loose.length > 0 && `${loose.length} loose passage${loose.length === 1 ? "" : "s"}`].filter(Boolean)

  return (
    <KnowledgeShell>
      <header className="px-0.5">
        {/* Questions may join as a second view; until then a lone tab strip would say nothing */}
        <h1 className="text-[22px] leading-tight font-medium tracking-tight">Knowledge</h1>
      </header>
      <RecentRun />
      {(topics.length >= FIND_FROM || query) && <FindField />}
      {topics.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Owlit is reading your material. Topics appear here as your notes, papers and chats start to connect.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.label}>
              {/* The group label earns its place only when it splits the list */}
              {groups.length > 1 && <h2 className="mb-1 px-2.5 text-xs text-muted-foreground">{g.label}</h2>}
              <div className="flex flex-col gap-0.5">
                {g.topics.map((t) => (
                  <TopicRow key={t.id} topic={t} />
                ))}
              </div>
            </section>
          ))}
          {words.length > 0 && !live.length && !archived.length && !looseHit && <p className="py-10 text-center text-sm text-muted-foreground">No topics match.</p>}
          {words.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              {archived.map((t) => (
                <TopicRow key={t.id} topic={t} />
              ))}
              {looseHit && <LooseRow count={loose.length} />}
            </section>
          ) : (
            aside.length > 0 && (
              <section className="flex flex-col gap-0.5">
                <FoldRow open={asideOpen} onClick={() => setAsideOpen((o) => !o)}>
                  Set aside · {aside.join(" · ")}
                </FoldRow>
                {asideOpen && (
                  <>
                    {archived.map((t) => (
                      <TopicRow key={t.id} topic={t} />
                    ))}
                    {loose.length > 0 && <LooseRow count={loose.length} />}
                  </>
                )}
              </section>
            )
          )}
        </div>
      )}
    </KnowledgeShell>
  )
}

// Notes and chat lines no topic holds; it never needs doing, so it sits folded with the archived topics
function LooseRow({ count }: { count: number }) {
  return (
    <Link
      to="/knowledge/loose"
      className="flex h-9 items-center rounded-md pr-1 pl-2.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"
    >
      Not in a topic yet · {count} passage{count === 1 ? "" : "s"}
    </Link>
  )
}

function FoldRow({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"
    >
      <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      {children}
    </button>
  )
}

// "Updated 3 min ago · 2 topics", only after a recent run; it opens what changed
function RecentRun() {
  const run = useKnowledgeStore((s) => s.lastRun)
  const topics = useTopics()
  const navigate = useNavigate()
  // The clock moves once a minute so "3 min ago" stays true
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  if (!run || now - run.at > RECENT_MS) return null
  const n = new Set(run.items.map((i) => i.topicId)).size
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="-ml-1 mt-3 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted data-[state=open]:bg-muted data-[state=open]:text-foreground">
          Updated {ago(run.at)} · {n} topic{n === 1 ? "" : "s"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-1">
        {run.items.map((i, n) => {
          const t = topics.find((x) => x.id === i.topicId)
          if (!t) return null
          return (
            <button
              key={n}
              type="button"
              onClick={() => navigate(`/knowledge/${t.id}`)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent focus-key:bg-accent"
            >
              <span className="text-sm font-medium">{t.name}</span>
              <span className="text-[13px] text-muted-foreground">{i.what}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function FindField() {
  const query = useKnowledgeUi((s) => s.query)
  const setQuery = useKnowledgeUi((s) => s.setQuery)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border bg-card pr-1.5 pl-3.5 transition-colors focus-within:border-foreground/30">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("")
            e.currentTarget.blur()
          }
        }}
        placeholder="Find a topic, a line or a question"
        aria-label="Find in Knowledge"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
      />
      {query ? (
        <Button variant="ghost" size="icon-sm" aria-label="Clear" onClick={() => setQuery("")} className="text-muted-foreground">
          <XIcon />
        </Button>
      ) : (
        <Kbd className="mr-1.5 bg-transparent">/</Kbd>
      )}
    </div>
  )
}

// The topic's name, its summary inline in muted text, the date at the right. No counts, no badges: the
// only mark is the dot, on a topic Owlit changed since the user last looked at it.
function TopicRow({ topic }: { topic: Topic }) {
  const navigate = useNavigate()
  const renaming = useKnowledgeUi((s) => s.renaming === topic.id)
  const set = useKnowledgeUi((s) => s.set)
  const side = useKnowledgeStore((s) => s.topics[topic.id])
  const fresh = !!side && changedSince(topic, side).length > 0

  if (renaming) {
    return (
      <div className="flex h-9 items-center rounded-md bg-muted px-1.5">
        <RenameInput topic={topic} onDone={() => set({ renaming: null })} className="h-7 flex-1 px-1 text-sm" />
      </div>
    )
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={(e) => !(e.target as HTMLElement).closest("button") && navigate(`/knowledge/${topic.id}`)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(`/knowledge/${topic.id}`)}
      className="group/row flex h-9 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 text-sm outline-none select-none hover:bg-muted focus-key:bg-muted has-data-[state=open]:bg-muted"
    >
      {fresh && <NoteDot className="-ml-0.5" label="Changed since you last looked" />}
      <span className={cn("shrink-0 truncate", topic.archived && "text-muted-foreground")}>{topic.name}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{topic.summary}</span>
      <span className="shrink-0 pr-1.5 text-[13px] text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden group-has-data-[state=open]/row:hidden">
        {shortDate(topic.updatedAt)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Topic actions"
            className="hidden text-muted-foreground group-hover/row:flex group-focus-within/row:flex hover:bg-foreground/8 data-[state=open]:flex data-[state=open]:bg-foreground/8"
          >
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <TopicMenuContent topic={topic} />
      </DropdownMenu>
    </div>
  )
}

// Rename in place; Enter or leaving keeps it, Esc puts the name back
export function RenameInput({ topic, onDone, className }: { topic: Topic; onDone: () => void; className?: string }) {
  const [value, setValue] = useState(topic.name)
  const done = useRef(false)
  const finish = (keep: boolean) => {
    if (done.current) return
    done.current = true
    if (keep) renameTopic(topic.id, value)
    onDone()
  }
  return (
    <input
      autoFocus
      value={value}
      aria-label="Topic name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true)
        if (e.key === "Escape") finish(false)
      }}
      className={cn("min-w-0 rounded-sm bg-transparent outline-none", className)}
    />
  )
}
