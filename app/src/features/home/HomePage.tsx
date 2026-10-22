import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
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
import { FRESH_CHAT } from "@/features/chat/components/ChatEmpty"
import { findPrompt } from "@/features/chat/lib/starters"
import { addPdfFiles } from "@/features/library/lib/add-pdfs"
import { usePaperActions } from "@/features/library/actions"
import { useWorkspace } from "@/lib/workspace"
import { refreshSummary, useProjects } from "@/features/projects/store"
import { SiteWaits, WaitingOnYou } from "./WaitingOnYou"
import { useNames } from "@/lib/actors"
import { OfferRows, ProjectGroups } from "./HomeProjects"
import { useOffers } from "./offers"
import { didWords } from "./did-words"
import { NewsDot, PlaceRow } from "./rows"
import { type Place, useNews, usePlaces, useProjectOfPlace } from "./where"

// Home: where the user was and what waits for them (WaitingOnYou), then the projects being worked on
// (HomeProjects), then the rest. What others changed is not listed as such: it is a mark on the row of the
// place it happened in, saying what came. PDFs dropped anywhere on it go to the Library.

const RECENT = 8

export function HomePage() {
  const { open } = usePaperActions()
  const places = usePlaces()
  // The journal moves with no word to the window (reading time, typing elsewhere): the summary is asked again
  // each time Home is shown
  useEffect(refreshSummary, [])
  const workspace = useWorkspace((s) => s.current)
  const { dragging, dropProps } = useFileDrop((data) => void addPdfFiles(Array.from(data.files), open))
  const [lead, ...rest] = places

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropProps}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-24">
          {/* The workspace folder is what this desk is about; its full path on hover */}
          <PageTitle className="px-2.5" title={workspace?.path}>
            {workspace?.name ?? t`Home`}
          </PageTitle>
          {lead ? (
            <>
              <LeadCard place={lead} />
              <div className="mt-8 empty:hidden">
                <WaitingOnYou />
              </div>
              <div className="mt-8 empty:hidden">
                <SiteWaits />
              </div>
              <ProjectGroups places={places} />
              <Recent places={rest} />
            </>
          ) : (
            <Start />
          )}
        </div>
      </div>
      {dragging && <DropOverlay label={t`Drop PDFs to add them to your Library`} />}
    </div>
  )
}

// The places after the lead. With projects marked, only those in none of them, under "Not in a project":
// a project's group above stands for the places inside it. With none marked, every place, as Recent.
// Above them, the one-time offers to make a project of a folder worked in lately.
function Recent({ places }: { places: Place[] }) {
  const marked = useProjects().length > 0
  const projectOf = useProjectOfPlace()
  const shown = (marked ? places.filter((p) => !projectOf(p)) : places).slice(0, RECENT)
  const offers = useOffers()
  if (!shown.length && !offers.length) return null
  return (
    <section className="mt-8">
      <GroupLabel>{marked ? t({ message: "Not in a project", comment: "Home: the group of places that belong to no project folder" }) : t`Recent`}</GroupLabel>
      <OfferRows offers={offers} />
      <div className="flex flex-col gap-0.5">
        {shown.map((p) => (
          <PlaceRow key={p.key} place={p} />
        ))}
      </div>
    </section>
  )
}

// The last thing worked on, with the user's own last words in it. First on the page, in the rows' own
// look (no card): it is where most launches go next.
function LeadCard({ place }: { place: Place }) {
  useNames()
  const news = useNews(place)
  // "Drafts · edited 2 h ago", "Lewis & Card · 2020 · read yesterday · Digest ready"
  const meta = [place.detail, didWords(place), news?.words].filter(Boolean).join(" · ")
  return (
    <section className="mt-5">
      <GroupLabel>{t({ message: "Continue", context: "Home: what was worked on last" })}</GroupLabel>
      <Link to={place.to} className="block rounded-md px-2.5 py-2 outline-none hover:bg-muted focus-key:bg-muted">
        <div className="flex min-w-0 items-center gap-2.5">
          {news ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              <NewsDot news={news} />
            </span>
          ) : (
            <KindIcon kind={place.kind} className="size-4 shrink-0 text-muted-foreground" />
          )}
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

// A workspace with nothing in it yet: four ways in, no checklist. Finding papers on a question starts as
// a chat, since Owlit gathers them only when asked and the question is said best in its own words.
function Start() {
  const navigate = useNavigate()
  const { open } = usePaperActions()
  const newDoc = useNewDoc()
  // The element itself rather than a ref, since the rows below hand its click out during render
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const rows = [
    { key: "papers", icon: KIND_ICON.paper, title: t`Add papers`, detail: t`Drop PDFs anywhere here, or choose them from your disk`, run: () => fileInput?.click() },
    { key: "doc", icon: KIND_ICON.doc, title: t`New doc`, detail: t`Notes and drafts are Markdown files in this folder`, run: () => newDoc("") },
    { key: "find", icon: KIND_ICON.thread, title: t`Find papers on a question`, detail: t`Owlit gathers papers for it, with what each one says`, run: () => navigate("/chat", { state: { starter: findPrompt() } }) },
    { key: "chat", icon: KIND_ICON.chat, title: t`Chat with Owlit`, detail: t`Ask about anything in this folder`, run: () => navigate("/chat", { state: FRESH_CHAT }) },
  ]
  const palette = keysFor("palette")
  const owlit = keysFor("owlit")
  const shortcuts = keysFor("shortcuts")
  return (
    <>
      <p className="mt-1.5 px-2.5 text-sm leading-normal text-muted-foreground">
        {t`This folder is your workspace. Papers, notes and chats you add live in it as ordinary files.`}
      </p>
      <div className="mt-5 empty:hidden">
        <WaitingOnYou />
      </div>
      <div className="mt-5 flex flex-col gap-0.5">
        {rows.map((r) => (
          <ListRow key={r.key} icon={r.icon} title={r.title} titleClassName="font-medium" detail={r.detail} onClick={r.run} className="h-11" />
        ))}
      </div>
      {/* The few keys worth knowing from the first day; gone with the rest once the workspace has things in it */}
      <p className="mt-7 px-2.5 text-detail text-muted-foreground">
        <Trans>
          {palette} find anything · {owlit} ask Owlit ·{" "}
          <button type="button" className="underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground" onClick={openShortcuts}>
            {shortcuts} all shortcuts
          </button>
        </Trans>
      </p>
      <PdfFileInput ref={setFileInput} multiple onFiles={(files) => void addPdfFiles(files, open)} />
    </>
  )
}
