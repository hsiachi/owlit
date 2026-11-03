import type { Row, Screen } from "./adapter.ts"

// What must hold on the screen after any step, whatever the story: the same paper counted the same way
// in the block, the waits list and its own card. Each broken one is a sentence of what the user would
// see wrong; checkInvariants throws them all at once, naming the step.

const waitKinds = new Set(["sign-in", "check", "blocked", "permission"])
const key = (w: { kind: string; host?: string }) => `${w.kind}:${w.host ?? ""}`

export function invariantErrors(screen: Screen): string[] {
  const errors: string[] = []
  const { block, waits, papers } = screen
  const waitByKey = new Map(waits.map((w) => [key(w), w]))

  for (const [id, p] of Object.entries(papers)) {
    // Core holds the paper for the user: the window finds the wait it is held under
    if (p.heldAt && (!p.foundUnder || key(p.foundUnder) !== key(p.heldAt))) errors.push(`${id} is held at ${key(p.heldAt)}, but the window finds it under ${p.foundUnder ? key(p.foundUnder) : "no wait"}`)
    if (p.hasPdf && (p.heldAt || p.foundUnder)) errors.push(`${id} has its PDF and still waits at ${key(p.heldAt ?? p.foundUnder!)}`)
  }

  // A wait's count is what the window can show under it: the papers it finds held there
  for (const w of waits) {
    const under = Object.values(papers).filter((p) => p.foundUnder && key(p.foundUnder) === key(w)).length
    if (under !== w.papers) errors.push(`the wait ${key(w)} says ${w.papers} papers, and the window finds ${under} under it`)
  }

  if (block) {
    const rows: Row[] = [...block.rows, ...block.outside]
    const seen = new Map<string, string>()
    for (const r of block.rows) {
      for (const id of r.ids) {
        if (seen.has(id)) errors.push(`${id} is counted twice, in ${seen.get(id)} and ${key(r)}`)
        seen.set(id, key(r))
      }
      if (block.batch && r.ids.length !== r.papers) errors.push(`the row ${key(r)} says ${r.papers} papers and holds ${r.ids.length}`)
      if (waitKinds.has(r.kind)) {
        // A site wait's row names a wait the user can act on
        const w = waitByKey.get(key(r))
        if (!w) errors.push(`the row ${key(r)} has no wait to act on`)
        else if (r.papers > w.papers) errors.push(`the row ${key(r)} counts ${r.papers} papers, more than its wait's ${w.papers}`)
        for (const id of r.ids) {
          const p = papers[id]
          if (p && (!p.foundUnder || key(p.foundUnder) !== key(r))) errors.push(`${id} is in the row ${key(r)}, but its own card is under ${p.foundUnder ? key(p.foundUnder) : "no wait"}`)
        }
      }
      for (const id of r.ids) if (papers[id]?.hasPdf) errors.push(`${id} has its PDF and is in the row ${key(r)}`)
    }
    if (block.batch) {
      // got + waiting + manual + none + still waiting = the batch's papers
      const counted = block.saved + block.rows.reduce((n, r) => n + r.papers, 0)
      if (counted !== block.total) errors.push(`the batch counts ${counted} papers in its rows and saved, of ${block.total}`)
      for (const id of seen.keys()) {
        const p = papers[id]
        if (p?.foundUnder && waitKinds.has(p.foundUnder.kind) && seen.get(id) !== key(p.foundUnder)) errors.push(`${id} waits at ${key(p.foundUnder)} and is in the row ${seen.get(id)}`)
      }
      if (!block.running && block.rows.some((r) => r.kind === "waiting" && !waits.length)) errors.push("the batch says it is done, with papers still waiting their turn and nothing to wait for")
    } else {
      // Without a batch, the rows are the waits
      const want = waits.map(key).sort()
      const got = block.rows.map(key).sort()
      if (want.join() !== got.join()) errors.push(`the block's rows (${got.join(", ")}) aren't the waits (${want.join(", ")})`)
    }
    // A site is one row
    const keys = rows.map(key)
    if (new Set(keys).size !== keys.length) errors.push(`a site has two rows: ${keys.join(", ")}`)
  } else if (waits.length) errors.push(`${waits.length} waits and no block to show them`)

  return errors
}

export function checkInvariants(screen: Screen, step: string) {
  const errors = invariantErrors(screen)
  if (errors.length) throw new Error(`After "${step}":\n- ${errors.join("\n- ")}`)
}
