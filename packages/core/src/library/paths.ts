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

export function paperDir(root: string, id: string) {
  if (!isPaperId(id)) throw new Error(`${id} is not a paper id`)
  return path.join(root, PAPERS_DIR, id)
}

export function paperStateDir(root: string, id: string) {
  if (!isPaperId(id)) throw new Error(`${id} is not a paper id`)
  return path.join(root, OWLIT_DIR, "papers", id)
}
