import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

// owlit-file://workspace/<path>: how the window reads a file of the open workspace (a paper's PDF).
// Only files inside the workspace, after links are followed; byte ranges, so the reader fetches what
// it shows rather than the whole file.

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".md": "text/markdown; charset=utf-8" }

export async function serveWorkspaceFile(root: string | undefined, request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (!root || url.hostname !== "workspace") return new Response(null, { status: 404 })
  let file: string
  try {
    const relative = url.pathname.split("/").map(decodeURIComponent).join("/")
    const resolved = path.resolve(root, `.${relative}`)
    const realRoot = await realpath(root)
    file = await realpath(resolved)
    if (file !== realRoot && !file.startsWith(realRoot + path.sep)) return new Response(null, { status: 403 })
  } catch {
    return new Response(null, { status: 404 })
  }
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return new Response(null, { status: 404 })

  const headers = new Headers({
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
    "cache-control": "no-cache",
  })
  const size = info.size
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/)
  if (range && (range[1] || range[2])) {
    // bytes=a-b, bytes=a-, bytes=-n (the last n)
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      headers.set("content-range", `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    start = Math.max(0, start)
    headers.set("content-range", `bytes ${start}-${end}/${size}`)
    headers.set("content-length", String(end - start + 1))
    if (request.method === "HEAD") return new Response(null, { status: 206, headers })
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers })
  }
  headers.set("content-length", String(size))
  if (request.method === "HEAD") return new Response(null, { status: 200, headers })
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers })
}
