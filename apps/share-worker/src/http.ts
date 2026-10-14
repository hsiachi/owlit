import { HttpFailure } from "@owlit/share-server/rules"

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } })

// A body of at most limit bytes, read to the end
export async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > limit) throw new HttpFailure(413, "That is more than this server takes.")
  if (!request.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > limit) throw new HttpFailure(413, "That is more than this server takes.")
    chunks.push(chunk)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}

// A JSON body of at most limit bytes
export async function readJson(request: Request, limit: number): Promise<unknown> {
  const text = new TextDecoder().decode(await readBody(request, limit))
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpFailure(400, "The body isn't JSON.")
  }
}
