// Collections brought in at once (Zotero, BibTeX, a folder of PDFs): the recent imports as core reports
// them, read again whenever an import's task changes, and the dialog that starts one. The progress itself
// is the import's task (features/tasks/store). Empty without the desktop app.

import type { ImportPreview, ImportSource, ImportSummary, Task } from "@owlit/protocol"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { bridge, isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { useTasksStore } from "@/features/tasks/store"

const isImportTask = (task: Pick<Task, "kind">) => /^import\.(zotero|bibtex|folder)$/.test(task.kind)

// An import stopped to ask whether MinerU may read the new papers' PDFs (paid for by the person's account)
export const importAsks = (task: Task) => task.state === "waiting_for_you" && task.waiting?.reason === "confirm_spend"

interface ImportsState {
  list: ImportSummary[]
}

export const useImports = create<ImportsState>(() => ({ list: [] }))

// The imports stopped to ask about MinerU, oldest first: their answers are on the Library's import line,
// which shows the first, and the rail's mark and Home's rows send the user there
export function useAskingImports(): ImportSummary[] {
  const list = useImports((s) => s.list)
  return useTasksStore(useShallow((s) => list.filter((i) => !!s.byId[i.taskId] && importAsks(s.byId[i.taskId]))))
}

async function load() {
  try {
    useImports.setState({ list: await rpc.library.imports() })
  } catch (error) {
    console.warn("[owlit] couldn't list imports", error)
  }
}

export function startImports() {
  if (!isDesktop) return
  // Each paper an import adds is one tasks.changed for the import's progress: the summary is read again
  // at most twice a second
  let timer: ReturnType<typeof setTimeout> | undefined
  onNotify("tasks.changed", ({ task }) => {
    if (!isImportTask(task) || timer) return
    timer = setTimeout(() => {
      timer = undefined
      void load()
    }, 500)
  })
  onWorkspaceOpened(() => void load())
  if (useWorkspace.getState().current) void load()
}

export async function startImport(source: ImportSource, path: string, options: { collectionsAsTags?: boolean; parse?: boolean }) {
  const started = await rpc.library.import({ source, path, ...options })
  useImports.setState((s) => ({ list: [started, ...s.list.filter((i) => i.id !== started.id)] }))
  return started
}

const refresh = <T>(done: Promise<T>) => done.then((value) => (void load(), value))

export const previewImport = (source: ImportSource, path: string): Promise<ImportPreview> => rpc.library.previewImport({ source, path })
export const answerImport = (id: string, parse: boolean) => refresh(rpc.library.importAnswer({ id, parse }))
export const continueImport = (id: string) => refresh(rpc.library.continueImport({ id }))
export const dismissImport = (id: string) => {
  useImports.setState((s) => ({ list: s.list.map((i) => (i.id === id ? { ...i, dismissed: true } : i)) }))
  return rpc.library.dismissImport({ id })
}

// ---- The dialog that starts one

type Step = { step: "source" } | { step: "review"; source: ImportSource; path: string }

interface DialogState {
  open: boolean
  at: Step
  // Where Zotero keeps its library on this Mac, once asked
  zotero: string | null | undefined
}

export const useImportDialog = create<DialogState>(() => ({ open: false, at: { step: "source" }, zotero: undefined }))

// File › Import Papers…, the empty Library's link: the first step, which asks where Zotero is
export function openImportDialog() {
  useImportDialog.setState({ open: true, at: { step: "source" } })
  if (useImportDialog.getState().zotero === undefined) {
    void rpc.library.findZotero().then(
      (zotero) => useImportDialog.setState({ zotero }),
      () => useImportDialog.setState({ zotero: null }),
    )
  }
}

// A .bib file or a folder dropped on the Library, or one just picked: straight to what will happen
export function reviewImport(source: ImportSource, path: string) {
  useImportDialog.setState({ open: true, at: { step: "review", source, path } })
}

export const closeImportDialog = () => useImportDialog.setState({ open: false })

// The system pickers for the other two sources
export async function pickImport(source: "zotero" | "bibtex" | "folder", labels: { title: string; buttonLabel: string }) {
  if (!bridge) return
  const path =
    source === "bibtex" ? await bridge.chooseFile({ ...labels, extensions: ["bib"] }) : await bridge.chooseFolder({ ...labels })
  if (path) reviewImport(source, path)
}
