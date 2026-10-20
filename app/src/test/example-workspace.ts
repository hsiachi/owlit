// The example workspace the app ships (apps/desktop/resources/example-workspace), read for the renderer's
// tests as core would give it out: threads with their papers' facts on each row. Tests that need a
// thread or a paper of a certain shape look for one here, so what they check is what pnpm dev:web shows.

import type { Thread, ThreadPaper, ThreadRead } from "@owlit/protocol"

const threadFiles = import.meta.glob<Thread>("../../../apps/desktop/resources/example-workspace/.owlit/threads/*/thread.json", { eager: true, import: "default" })
const paperFiles = import.meta.glob<ThreadPaper>("../../../apps/desktop/resources/example-workspace/library/papers/*/paper.json", { eager: true, import: "default" })

// A row's paper as the Library records it (library/papers/<id>/paper.json)
function paperFacts(id: string): ThreadPaper {
  const paper = Object.entries(paperFiles).find(([file]) => file.endsWith(`/papers/${id}/paper.json`))?.[1]
  if (!paper) throw new Error(`The example workspace has no paper ${id}`)
  return { title: paper.title, authors: paper.authors, ids: paper.ids, year: paper.year, venue: paper.venue, abstract: paper.abstract }
}

// Every thread of the example, by id
export function exampleThreads(): Record<string, ThreadRead> {
  const threads = Object.values(threadFiles).map((thread) => ({ ...thread, rows: thread.rows.map((r) => ({ ...r, paper: paperFacts(r.id) })) }))
  return Object.fromEntries(threads.map((c) => [c.id, c]))
}
