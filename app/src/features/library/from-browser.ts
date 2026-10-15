import { t } from "@lingui/core/macro"
import { isTaskFinished, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { rpc } from "@/lib/rpc"
import { useTasksStore } from "@/features/tasks/store"
import { useLibraryStore } from "./store"
import type { Paper } from "./types"

// Papers owlit couldn't get alone, got from the user's own browser one at a time by core's
// papers.fromBrowser run. Started from the paper's card, Home's Waiting on you, or the Library under
// Needs you; each of them shows the same run.

const KIND = "papers.fromBrowser"

// The run, while it goes on: its progress (done of total), and waiting_for_you when it stopped for the
// user (the paper it stopped on carries why, in noPdf.fromBrowser)
export const useFromBrowserRun = () => useTasksStore((s) => Object.values(s.byId).find((task) => task.kind === KIND && !isTaskFinished(task)))

// The paper a run stopped on, and what its tab showed
export const useStoppedOn = () =>
  useLibraryStore((s) => Object.values(s.papers).find((p) => p.noPdf?.fromBrowser?.state === "waiting"))

// Papers the user's browser hasn't been sent to yet: owlit couldn't get them alone, and no run tried
// them. Ones a run tried (no access, didn't come) are left to their own card's Try again, so Get them
// doesn't open the same paywalls again. The longest waiting first.
export const useWaitingForBrowser = () =>
  useLibraryStore(
    useShallow((s) =>
      Object.values(s.papers)
        .filter((p) => !p.pdf && p.noPdf?.needs === "browser" && !p.noPdf.noAccess && !p.noPdf.fromBrowser)
        .sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0)),
    ),
  )

// Article pages a run left open in the user's browser for them to save the PDF from, while Downloads is
// watched for it: they need the user too, though Get them has nothing to open for them
export const usePagesToSave = () =>
  useLibraryStore(useShallow((s) => Object.values(s.papers).filter((p) => !p.pdf && p.noPdf?.fromBrowser?.state === "page")))

// What a run did, by paper id: its progress note once it has ended
export interface RunTally {
  browser?: string
  got: string[]
  noAccess: string[]
  pages: string[]
  missed: string[]
}

// Runs the user put away, this session
const useDismissed = create<{ ids: string[] }>(() => ({ ids: [] }))
export const dismissRun = (id: string) => useDismissed.setState((s) => ({ ids: [...s.ids, id] }))

// The latest run that has ended, with its tally, until the user puts it away or another run starts
export function useLastRun(): { task: Task; tally: RunTally } | undefined {
  const dismissed = useDismissed((s) => s.ids)
  const task = useTasksStore((s) => {
    const runs = Object.values(s.byId).filter((task) => task.kind === KIND)
    const latest = runs.sort((a, b) => b.createdAt - a.createdAt)[0]
    return latest && latest.state === "done" ? latest : undefined
  })
  if (!task || dismissed.includes(task.id)) return undefined
  const tally = parseTally(task.progress?.note)
  return tally && tally.got.length + tally.noAccess.length + tally.pages.length + tally.missed.length > 0 ? { task, tally } : undefined
}

function parseTally(note: string | undefined): RunTally | undefined {
  if (!note) return undefined
  try {
    const value = JSON.parse(note) as Partial<RunTally>
    return { browser: value.browser, got: value.got ?? [], noAccess: value.noAccess ?? [], pages: value.pages ?? [], missed: value.missed ?? [] }
  } catch {
    return undefined
  }
}

// The short line for the paper a run stopped on: "Sign in to your library in Dia"
export function stoppedLine(paper: Paper | undefined) {
  const from = paper?.noPdf?.fromBrowser
  const browser = from?.browser
  const title = from?.page?.title || from?.page?.host || ""
  switch (from?.why) {
    case "sign-in":
      return browser ? t`Sign in to your library in ${browser}` : t`Sign in to your library in your browser`
    case "check":
      return browser ? t`${browser} is showing a check` : t`Your browser is showing a check`
    case "on-pdf":
    case "unknown":
      return browser ? t`${browser} is on “${title}”` : t`Your browser is on “${title}”`
    default:
      return browser ? t`${browser} may be asking you something` : t`Your browser may be asking you something`
  }
}

// Continue, or what continuing means: "I've signed in"
export const continueLabel = (paper: Paper | undefined) =>
  paper?.noPdf?.fromBrowser?.why === "sign-in" ? t`I've signed in` : t({ message: "Continue", context: "carry on getting PDFs from the browser" })

export async function getInBrowser(ids: string[]) {
  try {
    const papers = await rpc.library.getInBrowser({ ids })
    const { updatePaper } = useLibraryStore.getState()
    for (const paper of papers) updatePaper(paper.id, { noPdf: paper.noPdf })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t`Couldn't open your browser.`)
  }
}

// The browser to the front, at this paper's tab when owlit opened one
export async function showBrowser(id?: string) {
  try {
    await rpc.library.showBrowser({ id })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t`Couldn't open your browser.`)
  }
}
