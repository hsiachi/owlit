import type { Row, Screen } from "./adapter.ts"

// What must hold on the screen after any step, whatever the story: the same paper counted the same way
// in the block, the waits list and its own card. Each broken one is a sentence of what the user would
// see wrong; checkInvariants throws them all at once, naming the step.

const waitKinds = new Set(["sign-in", "check", "blocked", "permission"])
const userStates = new Set(["for-sign-in", "for-check", "for-permission", "blocked"])
// A row by the wait it is for (ExtensionWait.id), the rest by their kind
const key = (r: Pick<Row, "kind" | "wait">) => (r.wait ? `wait ${r.wait}` : r.kind)
const waitKey = (id: string) => `wait ${id}`

export function invariantErrors(screen: Screen): string[] {
  const errors: string[] = []
  const { block, waits, papers } = screen
  const waitById = new Map(waits.map((w) => [w.id, w]))

  for (const [id, p] of Object.entries(papers)) {
    // Core holds the paper for the user: the window finds the wait it is held under
    if (p.heldAt && p.foundUnder !== p.heldAt) errors.push(`${id} is held at ${p.heldAt}, but the window finds it under ${p.foundUnder ?? "no wait"}`)
    // Its card says it needs the user at a site: a wait in the Library holds it, for the user to act on
    if (p.state && userStates.has(p.state) && !p.foundUnder) errors.push(`${id} says "${p.title}", and no wait holds it`)
    if (p.hasPdf && (p.heldAt || p.foundUnder)) errors.push(`${id} has its PDF and still waits at ${p.heldAt ?? p.foundUnder}`)
  }

  // A wait's count is what the window can show under it: the papers it finds held there
  for (const w of waits) {
    const under = Object.values(papers).filter((p) => p.foundUnder === w.id).length
    if (under !== w.papers) errors.push(`the wait ${w.id} says ${w.papers} papers, and the window finds ${under} under it`)
  }

  if (block) {
    const rows: Row[] = [...block.rows, ...block.outside]
    const seen = new Map<string, string>()
    for (const r of block.rows) {
      for (const id of r.ids ?? []) {
        if (seen.has(id)) errors.push(`${id} is counted twice, in ${seen.get(id)} and ${key(r)}`)
        seen.set(id, key(r))
      }
      if (block.batch && r.ids && r.ids.length !== r.papers) errors.push(`the row ${key(r)} says ${r.papers} papers and holds ${r.ids.length}`)
      if (waitKinds.has(r.kind)) {
        // A site wait's row names a wait the user can act on
        const w = r.wait ? waitById.get(r.wait) : undefined
        if (!w) errors.push(`the row ${key(r)} has no wait to act on`)
        else if (r.papers > w.papers) errors.push(`the row ${key(r)} counts ${r.papers} papers, more than its wait's ${w.papers}`)
        for (const id of r.ids ?? []) {
          const p = papers[id]
          if (p && p.foundUnder !== r.wait) errors.push(`${id} is in the row ${key(r)}, but its own card is under ${p.foundUnder ?? "no wait"}`)
        }
      }
      for (const id of r.ids ?? []) if (papers[id]?.hasPdf) errors.push(`${id} has its PDF and is in the row ${key(r)}`)
    }
    if (block.batch) {
      errors.push(...batchCountErrors(screen))
      for (const id of seen.keys()) {
        const p = papers[id]
        if (p?.foundUnder && seen.get(id) !== waitKey(p.foundUnder)) errors.push(`${id} waits at ${p.foundUnder} and is in the row ${seen.get(id)}`)
      }
      // The bench looks once everything that moves by itself has moved: a batch still going then has a
      // paper the extension holds in line (an offline back-off, a gap still to run), or it spins for ever
      if (block.running && !screen.inLine) errors.push("the batch says it is getting PDFs, and nothing is in line at the extension")
      // A host that didn't answer holds its papers for as long as it takes: they are tried again by
      // themselves, and the batch says it is done meanwhile, with their row
      if (block.running !== block.rows.some((r) => r.kind === "waiting" || r.kind === "getting")) errors.push(block.running ? "the batch says it is getting PDFs, with nothing in line" : "the batch says it is done, with papers still in line")
    } else {
      // Without a batch, the rows are the waits
      const want = waits.map((w) => waitKey(w.id)).sort()
      const got = block.rows.map(key).sort()
      if (want.join() !== got.join()) errors.push(`the block's rows (${got.join(", ")}) aren't the waits (${want.join(", ")})`)
    }
    // A site is one row
    const keys = rows.map(key)
    if (new Set(keys).size !== keys.length) errors.push(`a site has two rows: ${keys.join(", ")}`)
  } else if (waits.length) errors.push(`${waits.length} waits and no block to show them`)

  // A gate handed papers again and again that gives nothing, and no wait says why: the user sees papers
  // go and come back with nothing, and no one to ask
  for (const gate of screen.silent) errors.push(`${gate} was handed papers all day and gave no PDF, with no wait to say why`)

  return errors
}

// The batch's block counts each of its papers once: its rows and the saved add up to its papers, and a
// site's row under them, for papers outside the batch, counts none of the batch's. These hold at any
// moment, a fetch out or not.
export function batchCountErrors({ block, papers }: Pick<Screen, "block" | "papers">): string[] {
  if (!block?.batch) return []
  const errors: string[] = []
  // got + waiting + manual + none + still waiting = the batch's papers
  const counted = block.saved + block.rows.reduce((n, r) => n + r.papers, 0)
  if (counted !== block.total) errors.push(`the batch counts ${counted} papers in its rows and saved, of ${block.total}`)
  const inBatch = new Set(block.ids)
  for (const r of block.outside) {
    const theirs = Object.entries(papers).filter(([id, p]) => p.foundUnder === r.wait && !inBatch.has(id)).length
    if (r.papers !== theirs) errors.push(`the row ${key(r)} under the batch counts ${r.papers} papers, and ${theirs} of the papers under it aren't the batch's: ${block.total} papers show as ${counted + r.papers - theirs}`)
  }
  return errors
}

export function checkInvariants(screen: Screen, step: string) {
  const errors = invariantErrors(screen)
  if (errors.length) throw new Error(`After "${step}":\n- ${errors.join("\n- ")}`)
}
