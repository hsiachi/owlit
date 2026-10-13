import { HttpFailure } from "@owlit/share-server/rules"

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } })

// A JSON body of at most limit bytes
export async function readJson(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > limit) throw new HttpFailure(413, "That is more than this server takes.")
  const text = await request.text()
  if (new TextEncoder().encode(text).length > limit) throw new HttpFailure(413, "That is more than this server takes.")
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpFailure(400, "The body isn't JSON.")
  }
}
