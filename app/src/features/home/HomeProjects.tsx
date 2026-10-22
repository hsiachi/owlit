import { plural, t } from "@lingui/core/macro"
import { Fragment, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { FolderIcon, XIcon } from "lucide-react"
import type { ProjectSummary } from "@owlit/protocol"
import { GroupLabel } from "@/components/group-label"
import { IconButton } from "@/components/icon-button"
import { InlineLink } from "@/components/inline-link"
import { ListRow } from "@/components/list-row"
import { NoteDot, WaitingDot } from "@/components/marks"
import { Button } from "@/components/ui/button"
import { useDocActions } from "@/features/docs/actions"
import { useDocsStore } from "@/features/docs/store"
import { baseName, displayName, parentPath, type WorkspaceFile } from "@/features/docs/types"
import { useDocsUiStore } from "@/features/docs/ui-store"
import type { ChatIndexState } from "@/features/chat/components/ChatEmpty"
import { useLibraryUi } from "@/features/library/ui-store"
import { useProjectsStore } from "@/features/projects/store"
import { KIND_ICON } from "@/lib/kinds"
import { shortDate } from "@/lib/time"
import { toastUndo } from "@/lib/toast"
import { dismissOffer, restoreOffer, type Offer } from "./offers"
import { lastParagraph } from "./places"
import { didWords } from "./did-words"
import { PlaceRow } from "./rows"
import type { Place } from "./where"

// Home by project: a group for each project the person is working on (worked on in their last few
// sessions, as core counts them), the quiet and finished ones folded into one line, and the one-time offer
// to make a project of a loose folder they worked in lately.

// A doc by its workspace path, as the docs store has it
const useFileAt = () => {
  const files = useDocsStore((s) => s.files)
  return useMemo(() => {
    const byPath = new Map(Object.values(files).map((f) => [f.path, f]))
    return (path: string | undefined) => (path ? byPath.get(path) : undefined)
  }, [files])
}

// Where a doc opens, by its workspace path
const useDocTo = () => {
  const fileAt = useFileAt()
  return useCallback(
    (path: string | undefined) => {
      const file = fileAt(path)
      return file ? `/docs/${file.id}` : undefined
    },
    [fileAt],
  )
}

// The doc a group starts with, as Home's places have it; one the person never wrote in through owlit's
// editor (edits from before the change log, the newest draft by someone else) isn't among them, and is
// drawn the same way from its file
function lastWorkedPlace(lastWorked: NonNullable<ProjectSummary["lastWorked"]>, places: Place[], file: WorkspaceFile | undefined): Place | undefined {
  const known = places.find((p) => p.kind === "doc" && p.id === lastWorked.path)
  if (known) return known
  if (!file) return undefined
  return {
    kind: "doc",
    key: `doc:${file.id}`,
    id: file.path,
    title: displayName(file.path),
    detail: baseName(parentPath(file.path)),
    at: lastWorked.at,
    to: `/docs/${file.id}`,
    words: file.content ? lastParagraph(file.content) : undefined,
    did: lastWorked.draft ? null : "edited",
  }
}

// A mark's due: line (YYYY-MM-DD) as a local day
const dueDate = (due: string) => {
  const [y, m, d] = due.split("-").map(Number)
  return shortDate(new Date(y!, m! - 1, d!).getTime())
}

// The groups, newest worked first. With none live the desk would be empty, which says less than a quiet
// one: every project not done gets its group then.
export function ProjectGroups({ places }: { places: Place[] }) {
  const summary = useProjectsStore((s) => s.summary)
  if (!summary?.projects.length) return null
  const byWork = [...summary.projects].sort((a, b) => (b.lastWorked?.at ?? 0) - (a.lastWorked?.at ?? 0))
  const live = byWork.filter((p) => p.live)
  const shown = live.length ? live : byWork.filter((p) => p.status !== "done")
  const folded = byWork.filter((p) => !shown.includes(p))
  return (
    <>
      {shown.map((p) => (
        <ProjectGroup key={p.path} project={p} places={places} />
      ))}
      {folded.length > 0 && <FoldedLine projects={folded} />}
    </>
  )
}

function ProjectGroup({ project, places }: { project: ProjectSummary; places: Place[] }) {
  const navigate = useNavigate()
  const fileAt = useFileAt()
  const docTo = useDocTo()
  const { name, due, lastWorked, waits, changed } = project
  const date = due && dueDate(due)
  const place = lastWorked && lastWorkedPlace(lastWorked, places, fileAt(lastWorked.path))
  const changedTo = docTo(project.changedIn)
  const ask = () => navigate("/chat", { state: { starter: whereDidIStop(name), project: project.path } satisfies ChatIndexState })
  return (
    <section className="mt-8">
      <GroupLabel className="justify-between gap-4">
        <span className="min-w-0 truncate" title={name}>
          {name}
        </span>
        {date && <span className="shrink-0">{t({ message: `due ${date}`, comment: "Home: a project's due date, as its project.md gives it" })}</span>}
      </GroupLabel>
      <div className="flex flex-col gap-0.5">
        {/* The doc last worked on, with the person's own last words in it */}
        {place && <PlaceRow place={place} detail={place.words ?? ""} end={didWords(place)} />}
        <WaitsRow waits={waits} docTo={docTo} />
        {changed > 0 && changedTo && (
          <ListRow
            to={changedTo}
            mark={<NoteDot label={false} />}
            title={plural(changed, { one: "# doc changed since you last looked", other: "# docs changed since you last looked" })}
            end={displayName(project.changedIn!)}
          />
        )}
        <ListRow icon={KIND_ICON.chat} title={t({ message: "Where did I stop?", comment: "Home: opens a chat asking Owlit where the person left off in this group's work" })} onClick={ask} />
      </div>
    </section>
  )
}

// The question "Where did I stop?" starts a chat with; the person sends it as it is or adds to it
const whereDidIStop = (name: string) =>
  t({
    message: `Where did I stop in ${name}? Look at what I did there lately and at its current drafts, and tell me where I left off.`,
    comment: "the question Home's “Where did I stop?” puts in a new chat; name is the folder's project name",
  })

// What waits on the person in the group's current drafts, in one sentence whose counts each lead to it
function WaitsRow({ waits, docTo }: { waits: ProjectSummary["waits"]; docTo: (path: string | undefined) => string | undefined }) {
  const navigate = useNavigate()
  const parts: { key: string; words: string; open: () => void }[] = []
  const commentsTo = docTo(waits.commentsIn)
  const proposalsTo = docTo(waits.proposalsIn)
  const { comments, proposals, noPdf } = waits
  if (comments && commentsTo) parts.push({ key: "comments", words: plural(comments, { one: "# comment on the current drafts", other: "# comments on the current drafts" }), open: () => navigate(commentsTo) })
  if (proposals && proposalsTo) parts.push({ key: "proposals", words: plural(proposals, { one: "# edit by Owlit", other: "# edits by Owlit" }), open: () => navigate(proposalsTo) })
  if (noPdf)
    parts.push({
      key: "pdf",
      words: plural(noPdf, { one: "# paper without a PDF", other: "# papers without a PDF" }),
      open: () => {
        useLibraryUi.getState().setFilter("no-pdf")
        navigate("/library")
      },
    })
  if (!parts.length) return null
  return (
    <div className="flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <WaitingDot />
      </span>
      <p className="min-w-0 flex-1 truncate">
        {parts.map((p, i) => (
          <Fragment key={p.key}>
            {i > 0 && <span className="text-muted-foreground"> · </span>}
            <InlineLink onClick={p.open}>{p.words}</InlineLink>
          </Fragment>
        ))}
      </p>
    </div>
  )
}

// "(since Oct 13)" after a quiet project's name
const sinceWords = (at: number) => {
  const date = shortDate(at)
  return t({ message: `(since ${date})`, comment: "Home: after a quiet project's name, the day it was last worked on" })
}

// The projects not shown as groups, in one muted line: the quiet ones with the day they were last worked
// on, then the done ones. A name opens its folder in the Docs tree, at the doc last worked on.
function FoldedLine({ projects }: { projects: ProjectSummary[] }) {
  const navigate = useNavigate()
  const docTo = useDocTo()
  const open = (p: ProjectSummary) => {
    const ui = useDocsUiStore.getState()
    ui.expandTo(p.path)
    ui.selectFolder(p.path)
    navigate(docTo(p.lastWorked?.path) ?? "/docs")
  }
  const comma = t({ message: ", ", context: "between things in a list" })
  const names = (list: ProjectSummary[], since: boolean) =>
    list.map((p, i) => (
      <Fragment key={p.path}>
        {i > 0 && comma}
        <InlineLink onClick={() => open(p)} className="text-muted-foreground hover:text-foreground focus-key:text-foreground">
          {p.name}
        </InlineLink>
        {since && p.lastWorked && <span className="ms-1">{sinceWords(p.lastWorked.at)}</span>}
      </Fragment>
    ))
  const quiet = projects.filter((p) => p.status !== "done")
  const done = projects.filter((p) => p.status === "done")
  return (
    <p className="mt-6 px-2.5 text-detail text-muted-foreground">
      {quiet.length > 0 && (
        <span>
          {t({ message: "Quiet:", comment: "Home: before the projects nobody worked on in the person's last few sessions" })} {names(quiet, true)}
        </span>
      )}
      {quiet.length > 0 && done.length > 0 && " · "}
      {done.length > 0 && (
        <span>
          {t({ message: "Done:", comment: "Home: before the projects whose project.md says status: done" })} {names(done, false)}
        </span>
      )}
    </p>
  )
}

// The one-time offer on each loose folder the person worked in lately (core's summary says which): the
// folder, the doc last worked on in it, and the Docs tree's own "Make this a project". Turned down, a
// folder isn't offered again in this window.
export function OfferRows({ offers }: { offers: Offer[] }) {
  const docTo = useDocTo()
  const { markAsProject } = useDocActions()
  const navigate = useNavigate()
  if (!offers.length) return null
  return (
    <ul className="flex flex-col gap-0.5">
      {offers.map((f) => {
        const to = docTo(f.doc)
        // "5110 · Final Review": where the doc sits below the folder, then its name
        const below = parentPath(f.doc).split("/").slice(1)
        const detail = [...below, displayName(f.doc)].join(" · ")
        const notNow = () => {
          dismissOffer(f.path)
          toastUndo(t({ message: "Won't offer that again", comment: "toast after the person turned down making a folder a project on Home" }), () => restoreOffer(f.path), { description: baseName(f.path) })
        }
        return (
          <li key={f.path} className="group/row relative flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-muted has-focus-key:bg-muted">
            {/* The row's own button lies under its words, so the buttons at its end stay buttons of their own */}
            <button type="button" onClick={() => to && navigate(to)} aria-label={`${baseName(f.path)} · ${detail}`} className="absolute inset-0 rounded-md outline-none" />
            <FolderIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
            <span className="pointer-events-none max-w-[60%] shrink-0 truncate">{baseName(f.path)}</span>
            <span className="pointer-events-none min-w-0 flex-1 truncate text-detail text-muted-foreground">{detail}</span>
            <Button size="sm" variant="ghost" className="relative -mr-1" onClick={() => markAsProject(f.path)}>
              {t({ message: "Make this a project", comment: "marks a folder of docs as a project" })}
            </Button>
            <IconButton label={t({ message: "Not now", comment: "Home: turns down making a folder a project; it isn't offered again" })} size="icon-xs" className="relative -mr-1.5" onClick={notNow}>
              <XIcon />
            </IconButton>
          </li>
        )
      })}
    </ul>
  )
}
