import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The tests' temp folders (a workspace, a core's app data, its socket and lock, for nearly every test) go
// into one folder per run, removed when the run ends, instead of piling up in the system's temp folder.
// Workers start after this and take TMPDIR with them, so tmpdir() there is this folder.
export default function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "owlit-test-"))
  process.env.TMPDIR = root
  return () => rmSync(root, { recursive: true, force: true })
}
