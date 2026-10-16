import { t } from "@lingui/core/macro"
import { chatOfFile, fileKindOf, RpcErrorCode, type AttachmentFile, type ParamsOf, type ResultOf } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import path from "node:path"
import { isDocsPath } from "../docs/docs.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { messageOf } from "../util.ts"

type Params = ParamsOf<"chats.attach">
type Result = ResultOf<"chats.attach">

// A file the user attaches to a message. What owlit already has is
// pointed at rather than copied, since each thing has one home: a PDF the Library has (the same bytes)
// is that paper, so the agent also gets its notes and highlights; a file in the user's docs is that doc.
// Anything else is copied into the chat's folder now, when it is attached, so sending never waits on a
// copy, and the chat keeps what it sent however the original changes or moves.
export async function attachFile(ws: Workspace, params: Params): Promise<Result> {
  const { chatId } = params
  if (params.path) {
    const source = params.path
    const info = await stat(source).catch(() => null)
    if (!info) throw new RpcFailure(RpcErrorCode.NotFound, t`owlit can't read that file.`, { path: source })
    if (info.isDirectory()) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Folders can't be attached yet.`, { path: source, folder: true })
    const name = path.basename(source)
    const mimeType = params.mimeType ?? ""
    const real = await realpath(source)
    if (fileKindOf(name, mimeType) === "pdf") {
      const paperId = await ws.library.paperOfFile(real).catch(() => undefined)
      if (paperId) return { kind: "paper", paperId }
    }
    const rel = path.relative(await realpath(ws.root), real)
    const inside = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : null
    if (inside && isDocsPath(inside)) return { kind: "doc", path: inside }
    // A copy another message already has (dragged out of a chip) is copied again: each chat keeps its own
    const kept = await ws.chats.copyIn(chatId, real, name).catch((error) => {
      throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit couldn't copy that file.`, { path: source, reason: messageOf(error) })
    })
    return { kind: "file", file: fileOf(name, info.size, mimeType, kept) }
  }
  if (params.data === undefined) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Give the file's path or its contents.`)
  const bytes = Buffer.from(params.data, "base64")
  const name = params.name?.trim() || "Pasted file"
  const kept = await ws.chats.writeIn(chatId, name, bytes)
  return { kind: "file", file: fileOf(name, bytes.length, params.mimeType ?? "", kept) }
}

const fileOf = (name: string, size: number, mimeType: string, kept: string): AttachmentFile => ({ id: randomUUID(), name, size, mimeType, path: kept })

// A copy of an attached file, as a workspace path, refused for anything else
export function chatFile(rel: string) {
  const normal = path.posix.normalize(rel)
  if (normal !== rel || !chatOfFile(rel)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`That isn't a file attached to a chat.`, { path: rel })
  return rel
}
