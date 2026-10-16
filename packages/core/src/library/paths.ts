import path from "node:path"
import { OWLIT_DIR } from "../workspace/paths.ts"

// Where a paper lives. library/papers/<id>/ holds what the paper is (regenerable); .owlit/papers/<id>/
// holds what the user thinks of it (kept forever).

export const PAPERS_DIR = path.join("library", "papers")

// Ids are folder names: refs.paperIdOf makes them, local-<hash> for files nobody knows. Ids from a
// pitta library keep their case (arxiv-math.GT-0309136).
const PAPER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function isPaperId(id: string) {
  return PAPER_ID.test(id) && !id.includes("..")
}

// Made only where a paper comes in, moves or is put back (add, drop, relink, restore). What is written
// into it later never makes it: a paper's tasks are cancelled when it moves to a DOI or goes to the
// trash, but one may be past its last look at the signal, and its write must fail then instead of
// bringing the old id's folder back. A task's writes into it pass { parents: false } (the user's note
// is written under the library's lock, once the paper is found there).
export function paperDir(root: string, id: string) {
  if (!isPaperId(id)) throw new Error(`${id} is not a paper id`)
  return path.join(root, PAPERS_DIR, id)
}

export function paperStateDir(root: string, id: string) {
  if (!isPaperId(id)) throw new Error(`${id} is not a paper id`)
  return path.join(root, OWLIT_DIR, "papers", id)
}
