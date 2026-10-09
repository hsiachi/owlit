import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { BookOpenIcon, FileTextIcon, FileUpIcon, MessageSquareIcon } from "lucide-react"
import { useNewDoc } from "@/features/docs/use-new-doc"
import { addPdfFiles } from "@/features/library/lib/add-pdfs"
import { useWorkspace } from "@/lib/workspace"
import { WaitingOnYou } from "./WaitingOnYou"
import { AWAY_FOR, SinceYouLeft } from "./SinceYouLeft"
import { useTrail, workspaceKey } from "./trail"
import { type Kind, type Place, usePlaces, when } from "./where"

// Home answers, in this order: where was I (every launch), what is waiting for me (only while something
// waits) and what changed while I was away (only after three days or more). There is no composer: asking
// happens in Chat and the agent window. PDFs dropped anywhere on it go to the Library.

const ICON: Record<Kind, typeof FileTextIcon> = { doc: FileTextIcon, chat: MessageSquareIcon, paper: BookOpenIcon }
const RECENT = 8

export function HomePage() {
  const places = usePlaces()
  const workspace = useWorkspace((s) => s.current)
  const awayFrom = useTrail((s) => s.awayFrom[workspaceKey()])
  const [dragging, setDragging] = useState(0)
  const [lead, ...rest] = places
  const [openedAt] = useState(() => Date.now())
  const since = awayFrom && openedAt - awayFrom >= AWAY_FOR ? awayFrom : null

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      // Counting enter/leave pairs keeps the overlay from flickering over child elements
      onDragEnter={(e) => hasFiles(e) && setDragging((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setDragging((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(0)
        void addPdfFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-24">
          {/* The workspace folder is what this desk is about; its full path on hover */}
          <h1 className="px-2.5 text-[22px] leading-tight font-medium tracking-tight" title={workspace?.path}>
            {workspace?.name ?? "Home"}
          </h1>
          {lead ? (
            <>
              <div className="mt-5 empty:hidden">
                <WaitingOnYou />
              </div>
              <LeadCard place={lead} />
              {since && <SinceYouLeft since={since} />}
              {rest.length > 0 && (
                <section className="mt-8">
                  <h2 className="mb-1 px-2.5 text-xs text-muted-foreground">Recent</h2>
                  <div className="flex flex-col gap-0.5">
                    {rest.slice(0, RECENT).map((p) => (
                      <PlaceRow key={p.key} place={p} />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <Start />
          )}
        </div>
      </div>
      {dragging > 0 && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/20 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileUpIcon className="size-4" />
            Drop PDFs to add them to your Library
          </div>
        </div>
      )}
    </div>
  )
}

// The last thing worked on, with the user's own last words in it
function LeadCard({ place }: { place: Place }) {
  const Icon = ICON[place.kind]
  // "Drafts · edited 2 h ago", "Lewis & Card · 2020 · read yesterday"
  const time = when(place.at)
  const did = place.did ? `${place.did} ${/^(Just now|Yesterday)$/.test(time) ? time.toLowerCase() : time}` : time
  const meta = [place.detail, did].filter(Boolean).join(" · ")
  return (
    <Link
      to={place.to}
      className="mt-5 block rounded-[10px] border bg-card px-4 pt-3.5 pb-4 outline-none transition-colors hover:border-foreground/20 focus-key:border-foreground/30"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{place.title}</span>
        <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">{meta}</span>
      </div>
      {place.words && <p className="mt-2.5 line-clamp-3 border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground">{place.words}</p>}
    </Link>
  )
}

function PlaceRow({ place }: { place: Place }) {
  const Icon = ICON[place.kind]
  return (
    <Link to={place.to} className="flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm outline-none hover:bg-muted focus-key:bg-muted">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="max-w-[62%] shrink-0 truncate">{place.title}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{place.detail}</span>
      <span className="shrink-0 text-[13px] text-muted-foreground">{when(place.at)}</span>
    </Link>
  )
}

// A workspace with nothing in it yet: three ways in, no checklist
function Start() {
  const navigate = useNavigate()
  const newDoc = useNewDoc()
  const fileInput = useRef<HTMLInputElement>(null)
  const rows = [
    { icon: BookOpenIcon, title: "Add papers", detail: "Drop PDFs anywhere here, or choose them from your disk", run: () => fileInput.current?.click() },
    { icon: FileTextIcon, title: "New doc", detail: "Notes and drafts are Markdown files in this folder", run: () => newDoc("") },
    { icon: MessageSquareIcon, title: "Chat with Owlit", detail: "Ask about your papers once they’re in", run: () => navigate("/chat") },
  ]
  return (
    <>
      <p className="mt-1.5 px-2.5 text-sm leading-normal text-muted-foreground">This folder is your workspace. Papers, notes and chats you add live in it as ordinary files.</p>
      <div className="mt-5 empty:hidden">
        <WaitingOnYou />
      </div>
      <div className="mt-5 flex flex-col gap-0.5">
        {rows.map((r) => (
          <button
            key={r.title}
            type="button"
            onClick={r.run}
            className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-key:bg-muted"
          >
            <r.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">{r.title}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{r.detail}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          void addPdfFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
    </>
  )
}
