import type { ParsingSettings } from "@owlit/protocol"
import { HttpError, sleep, type Http } from "../../net/http.ts"
import type { ContentBlock } from "./convert.ts"
import { unzip } from "./unzip.ts"

// MinerU, in the cloud (mineru.net's v4 API: ask for an upload URL, upload, poll, download a zip) or
// self-hosted (one POST to its /file_parse). What comes back is its content_list: blocks in reading
// order with where they sit.

const CLOUD = "https://mineru.net"
const POLL_MS = 5000

// MinerU refused for a reason another try won't change (a bad token, a file it can't read)
export class ParseRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParseRefused"
  }
}

export interface CloudJob {
  batchId: string
  uploadUrl: string
}

export interface CloudState {
  state: "waiting-file" | "pending" | "running" | "converting" | "done" | "failed" | "unknown"
  zipUrl?: string
  error?: string
  pages?: { done: number; total: number }
}

const base = (settings: ParsingSettings) => (settings.url ?? CLOUD).replace(/\/+$/, "")
const auth = (settings: ParsingSettings) => ({ authorization: `Bearer ${settings.token ?? ""}`, "content-type": "application/json" })

interface Envelope<T> {
  code: number | string
  msg?: string
  data?: T
}

async function call<T>(http: Http, url: string, init: Parameters<Http["get"]>[1]): Promise<T> {
  let answer: Envelope<T>
  try {
    answer = await http.json<Envelope<T>>(url, init)
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) throw new ParseRefused("MinerU didn't accept the token.")
    throw error
  }
  if (answer.code !== 0 && answer.code !== "0") {
    // A0202/A0211: token; -60018/-60019: quota; -500xx/-600xx about the file
    const code = String(answer.code)
    const message = `MinerU said: ${answer.msg ?? code}`
    if (/^A02|^-6001[89]|^-6000[2-9]|^-6001[0-7]/.test(code)) throw new ParseRefused(message)
    throw new Error(message)
  }
  return answer.data as T
}

// Asks for a place to upload one PDF. dataId comes back with the result, so the job can be found
export async function submitCloud(http: Http, settings: ParsingSettings, name: string, dataId: string, signal?: AbortSignal): Promise<CloudJob> {
  const data = await call<{ batch_id: string; file_urls: string[] }>(http, `${base(settings)}/api/v4/file-urls/batch`, {
    method: "POST",
    headers: auth(settings),
    body: JSON.stringify({ files: [{ name, data_id: dataId }], model_version: "vlm" }),
    signal,
  })
  if (!data?.batch_id || !data.file_urls?.[0]) throw new Error("MinerU didn't give an upload address.")
  return { batchId: data.batch_id, uploadUrl: data.file_urls[0] }
}

// The presigned URL takes the bytes as they are: no content type, or the signature breaks
export async function uploadCloud(http: Http, job: CloudJob, bytes: Uint8Array, signal?: AbortSignal) {
  const response = await http.get(job.uploadUrl, { method: "PUT", body: bytes, signal, timeoutMs: 300_000 })
  await response.body?.cancel().catch(() => {})
}

export async function checkCloud(http: Http, settings: ParsingSettings, batchId: string, signal?: AbortSignal): Promise<CloudState> {
  interface Result {
    state?: string
    full_zip_url?: string
    err_msg?: string
    extract_progress?: { extracted_pages?: number; total_pages?: number }
  }
  const data = await call<{ extract_result?: Result[] }>(http, `${base(settings)}/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`, {
    headers: auth(settings),
    signal,
  })
  const result = data?.extract_result?.[0]
  const known = ["waiting-file", "pending", "running", "converting", "done", "failed"] as const
  const state = (known as readonly string[]).includes(result?.state ?? "") ? (result!.state as CloudState["state"]) : "unknown"
  const progress = result?.extract_progress
  return {
    state,
    zipUrl: result?.full_zip_url,
    error: result?.err_msg || undefined,
    pages: progress?.total_pages ? { done: progress.extracted_pages ?? 0, total: progress.total_pages } : undefined,
  }
}

// Polls until the job is done, then reads content_list.json out of its zip
export async function awaitCloud(
  http: Http,
  settings: ParsingSettings,
  batchId: string,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; timeoutMs?: number; pollMs?: number } = {},
): Promise<ContentBlock[]> {
  const until = Date.now() + (options.timeoutMs ?? 30 * 60_000)
  for (;;) {
    const state = await checkCloud(http, settings, batchId, options.signal)
    if (state.pages) options.onProgress?.(state.pages.done, state.pages.total)
    if (state.state === "done" && state.zipUrl) return contentListFromZip(Buffer.from(await (await http.get(state.zipUrl, { signal: options.signal, timeoutMs: 300_000 })).arrayBuffer()))
    if (state.state === "failed") throw new ParseRefused(`MinerU couldn't read the PDF${state.error ? `: ${state.error}` : "."}`)
    if (Date.now() > until) throw new Error("MinerU is taking too long; owlit will look again later.")
    await sleep(options.pollMs ?? POLL_MS, options.signal)
  }
}

export function contentListFromZip(zip: Buffer): ContentBlock[] {
  const files = unzip(zip)
  const name = [...files.keys()].find((n) => /content_list\.json$/.test(n) && !/_v2\.json$/.test(n))
  if (!name) throw new Error("MinerU's result has no content list.")
  return JSON.parse(files.get(name)!.toString("utf8")) as ContentBlock[]
}

// A self-hosted MinerU API (mineru-api): one request that answers with the content list
export async function parseSelfHosted(http: Http, settings: ParsingSettings, name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<ContentBlock[]> {
  if (!settings.url) throw new ParseRefused("Set the address of the MinerU server first.")
  const form = new FormData()
  form.append("files", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), name)
  form.append("return_content_list", "true")
  form.append("return_md", "false")
  const answer = await http.json<{ results?: Record<string, { content_list?: string | ContentBlock[] }> }>(`${base(settings)}/file_parse`, {
    method: "POST",
    body: form,
    signal,
    timeoutMs: 30 * 60_000,
  })
  const result = Object.values(answer.results ?? {})[0]
  const list = typeof result?.content_list === "string" ? (JSON.parse(result.content_list) as ContentBlock[]) : result?.content_list
  if (!list) throw new Error("The MinerU server sent no content list.")
  return list
}
