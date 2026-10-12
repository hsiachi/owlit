import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { keysFor, openShortcuts } from "@/app/shortcuts"
import { DropOverlay, PdfFileInput } from "@/components/file-drop"
import { GroupLabel } from "@/components/group-label"
import { KindIcon } from "@/components/kind-icon"
import { ListRow } from "@/components/list-row"
import { PageTitle } from "@/components/page"
import { useFileDrop } from "@/hooks/use-file-drop"
import { Quote } from "@/components/quote"
import { KIND_ICON } from "@/lib/kinds"
import { useNewDoc } from "@/features/docs/use-new-doc"
import { addPdfFiles } from "@/features/library/lib/add-pdfs"
import { useWorkspace } from "@/lib/workspace"
import { WaitingOnYou } from "./WaitingOnYou"
import { AWAY_FOR, SinceYouLeft } from "./SinceYouLeft"
import { useTrail, workspaceKey } from "./trail"
import { ago } from "@/lib/time"
import { type Place, usePlaces } from "./where"

// Home answers, in this order: where was I (every launch), what is waiting for me (only while something
// waits) and what changed while I was away (only after three days or more). There is no composer: asking
// happens in Chat and the agent window. PDFs dropped anywhere on it go to the Library.

const RECENT = 8

export function HomePage() {
  const places = usePlaces()
  const workspace = useWorkspace((s) => s.current)
  const awayFrom = useTrail((s) => s.awayFrom[workspaceKey()])
  const { dragging, dropProps } = useFileDrop((data) => void addPdfFiles(Array.from(data.files)))
  const [lead, ...rest] = places
  const [openedAt] = useState(() => Date.now())
  const since = awayFrom && openedAt - awayFrom >= AWAY_FOR ? awayFrom : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropProps}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-24">
          {/* The workspace folder is what this desk is about; its full path on hover */}
          <PageTitle className="px-2.5" title={workspace?.path}>
            {workspace?.name ?? "Home"}
          </PageTitle>
          {lead ? (
            <>
              <LeadCard place={lead} />
              <div className="mt-8 empty:hidden">
                <WaitingOnYou />
              </div>
              {since && <SinceYouLeft since={since} />}
              {rest.length > 0 && (
                <section className="mt-8">
                  <GroupLabel>Recent</GroupLabel>
                  <div className="flex flex-col gap-0.5">
                    {rest.slice(0, RECENT).map((p) => (
                      <ListRow key={p.key} to={p.to} icon={KIND_ICON[p.kind]} title={p.title} detail={p.detail} end={ago(p.at)} />
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
      {dragging && <DropOverlay label="Drop PDFs to add them to your Library" />}
    </div>
  )
}

// The last thing worked on, with the user's own last words in it. First on the page, in the rows' own
// look (no card): it is where most launches go next.
function LeadCard({ place }: { place: Place }) {
  // "Drafts · edited 2 h ago", "Lewis & Card · 2020 · read yesterday"
  const did = place.did ? `${place.did} ${ago(place.at, { inSentence: true })}` : ago(place.at)
  const meta = [place.detail, did].filter(Boolean).join(" · ")
  return (
    <section className="mt-5">
      <GroupLabel>Continue</GroupLabel>
      <Link to={place.to} className="block rounded-md px-2.5 py-2 outline-none hover:bg-muted focus-key:bg-muted">
        <div className="flex min-w-0 items-center gap-2.5">
          <KindIcon kind={place.kind} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{place.title}</span>
          <span className="shrink-0 text-detail whitespace-nowrap text-muted-foreground">{meta}</span>
        </div>
        {place.words && (
          <Quote size="sm" clamp={3} className="mt-2 ml-6.5">
            {place.words}
          </Quote>
        )}
      </Link>
    </section>
  )
}

// A workspace with nothing in it yet: three ways in, no checklist
function Start() {
  const navigate = useNavigate()
  const newDoc = useNewDoc()
  // The element itself rather than a ref, since the rows below hand its click out during render
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const rows = [
    { icon: KIND_ICON.paper, title: "Add papers", detail: "Drop PDFs anywhere here, or choose them from your disk", run: () => fileInput?.click() },
    { icon: KIND_ICON.doc, title: "New doc", detail: "Notes and drafts are Markdown files in this folder", run: () => newDoc("") },
    { icon: KIND_ICON.chat, title: "Chat with Owlit", detail: "Ask, or hand off work like finding papers", run: () => navigate("/chat") },
  ]
  return (
    <>
      <p className="mt-1.5 px-2.5 text-sm leading-normal text-muted-foreground">This folder is your workspace. Papers, notes and chats you add live in it as ordinary files.</p>
      <div className="mt-5 empty:hidden">
        <WaitingOnYou />
      </div>
      <div className="mt-5 flex flex-col gap-0.5">
        {rows.map((r) => (
          <ListRow key={r.title} icon={r.icon} title={r.title} titleClassName="font-medium" detail={r.detail} onClick={r.run} className="h-11" />
        ))}
      </div>
      {/* The few keys worth knowing from the first day; gone with the rest once the workspace has things in it */}
      <p className="mt-7 px-2.5 text-detail text-muted-foreground">
        {keysFor("palette")} find anything · {keysFor("owlit")} ask Owlit ·{" "}
        <button type="button" className="underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground" onClick={openShortcuts}>
          {keysFor("shortcuts")} all shortcuts
        </button>
      </p>
      <PdfFileInput ref={setFileInput} multiple onFiles={(files) => void addPdfFiles(files)} />
    </>
  )
}
