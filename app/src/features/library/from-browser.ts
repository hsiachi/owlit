import { t } from "@lingui/core/macro"
import { isTaskFinished, type Task } from "@owlit/protocol"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { tasksOfKind, useTasksStore } from "@/features/tasks/store"
import { mightComeThroughBrowser } from "./lib/filter"
import { useLibraryStore } from "./store"
import type { Paper } from "./types"

// Papers owlit couldn't get alone, got from the user's own browser one at a time by core's
// papers.fromBrowser run. Started from the paper's card, Home's Waiting on you, or the Library under
// Needs you; each of them shows the same run.

const KIND = "papers.fromBrowser"

// The run, while it goes on: its progress (done of total), and waiting_for_you when it stopped for the
// user (the paper it stopped on carries why, in noPdf.fromBrowser)
export const useFromBrowserRun = () => useTasksStore((s) => tasksOfKind(s.byId, KIND).find((task) => !isTaskFinished(task)))

// The paper a run stopped on, and what its tab showed
export const useStoppedOn = () =>
  useLibraryStore((s) => Object.values(s.papers).find((p) => p.noPdf?.fromBrowser?.state === "waiting"))

// The papers waiting on the user's browser, found once per papers object: the store's other changes (a
// highlight, a note) keep it, and the sidebar asks on every one. Shared: don't sort or change them.
type ForBrowser = { waiting: Paper[]; pages: Paper[] }
const forBrowser = new WeakMap<Record<string, Paper>, ForBrowser>()
function forBrowserOf(papers: Record<string, Paper>): ForBrowser {
  let found = forBrowser.get(papers)
  if (found) return found
  const all = Object.values(papers)
  found = {
    // Papers the user's browser hasn't been sent to yet: owlit couldn't get them alone, and no run tried
    // them. Ones a run tried (no access, didn't come) are left to their own card's Try again, so Get them
    // doesn't open the same paywalls again. The longest waiting first.
    waiting: all.filter((p) => !p.pdf && p.noPdf?.needs === "browser" && !p.noPdf.noAccess && !p.noPdf.fromBrowser).sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0)),
    // Article pages a run left open in the user's browser for them to save the PDF from, while Downloads
    // is watched for it: they need the user too, though Get them has nothing to open for them
    pages: all.filter((p) => !p.pdf && p.noPdf?.fromBrowser?.state === "page"),
  }
  forBrowser.set(papers, found)
  return found
}

export const useWaitingForBrowser = () => useLibraryStore(useShallow((s) => forBrowserOf(s.papers).waiting))
export const useWaitingForBrowserCount = () => useLibraryStore((s) => forBrowserOf(s.papers).waiting.length)
export const usePagesToSave = () => useLibraryStore(useShallow((s) => forBrowserOf(s.papers).pages))

// Papers owlit found nothing for that the user's browser hasn't been sent for: a long shot, offered only
// in the No PDF view (lib/filter.ts)
export const useMightComeThroughBrowser = () =>
  useLibraryStore(useShallow((s) => Object.values(s.papers).filter(mightComeThroughBrowser).sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0))))

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
    // The first of the newest, as a stable sort would put it
    const latest = tasksOfKind(s.byId, KIND).reduce<Task | undefined>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), undefined)
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
    toastError(e, t`Couldn't open your browser.`)
  }
}

// The browser to the front, at this paper's tab when owlit opened one
export async function showBrowser(id?: string) {
  try {
    await rpc.library.showBrowser({ id })
  } catch (e) {
    toastError(e, t`Couldn't open your browser.`)
  }
}
