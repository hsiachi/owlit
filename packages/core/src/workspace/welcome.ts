// What the welcome page offers before any workspace is open: where a new workspace would go, and
// making its folder. A new workspace is always a new folder, so Create never opens one that has files.

import { RpcErrorCode } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { RpcFailure } from "../rpc/index.ts"

const NAME = "Research"

// Documents when there is one, else the home folder; "Research", or "Research 2" and on when taken
export function suggestFolder(home = homedir()) {
  const documents = path.join(home, "Documents")
  const parent = existsSync(documents) ? documents : home
  let name = NAME
  for (let n = 2; existsSync(path.join(parent, name)); n++) name = `${NAME} ${n}`
  return { parent, name }
}

// Makes the folder for a new workspace and returns its path
export async function createFolder(parent: string, name: string) {
  const clean = name.trim()
  if (!clean || clean === "." || clean === ".." || /[/\\:]/.test(clean)) {
    throw new RpcFailure(RpcErrorCode.InvalidParams, "A folder name can't be empty or contain / \\ or :.")
  }
  if (clean.startsWith(".")) throw new RpcFailure(RpcErrorCode.InvalidParams, "A folder name starting with a dot would be hidden in Finder.")
  const folder = path.join(path.resolve(parent), clean)
  if (existsSync(folder)) throw new RpcFailure(RpcErrorCode.Conflict, `There is already a folder called ${clean} in ${path.basename(parent) || parent}.`, { path: folder })
  await mkdir(folder, { recursive: true })
  return folder
}
