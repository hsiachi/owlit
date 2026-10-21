import { docUri, paperUri, threadUri } from "@owlit/protocol"
import { routeSubject } from "@/app/route-subject"
import { useDocsStore } from "@/features/docs/store"
import { useLibraryStore } from "@/features/library/store"
import { useThreadsStore } from "@/features/threads/store"

// The address of the paper, doc or thread a route shows, as its chip carries it into a question
// (page-context.ts); null on a page about nothing in particular (Home, a list, Chat). Read from the stores
// as they are, for the agent window's store, which has no hooks.
export function pageUri(pathname: string): string | null {
  const subject = routeSubject(pathname)
  if (!subject) return null
  if (subject.kind === "doc") {
    const file = useDocsStore.getState().files[subject.id]
    return file ? docUri(file.path) : null
  }
  if (subject.kind === "paper") return useLibraryStore.getState().papers[subject.id] ? paperUri(subject.id) : null
  if (subject.kind === "thread") return useThreadsStore.getState().threads[subject.id] ? threadUri(subject.id) : null
  return null
}

// The same for the page on screen (the router is the browser's history, so its path is the route)
export const currentPageUri = () => pageUri(window.location.pathname)
