// The models the engine can use and how it signs in to them, on top of pi-ai. Only a short list of
// providers is offered (engine-proposal.md): ChatGPT's sign-in, and API keys for the rest. Claude is here
// by API key only: Anthropic's terms keep Claude Pro/Max sign-ins to Claude Code.

import type { AuthMethod } from "@agentclientprotocol/sdk"
import { createModels, type Api, type Credential, type CredentialInfo, type CredentialStore, type Model, type Models, type Provider } from "@earendil-works/pi-ai"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const PROVIDERS: (() => Provider)[] = [openaiProvider, anthropicProvider, openrouterProvider, deepseekProvider, qwenTokenPlanCnProvider, moonshotaiCnProvider]

export const CHATGPT = "chatgpt"
const API_KEY = "api-key:"

// The picker shows the newest model of each family (claude-sonnet, gpt-mini, kimi), at most a few per
// provider, newest first. The catalogs list every dated snapshot, alias and variant, and models for
// audio, images or search that a chat can't use. OpenRouter lists hundreds, so it keeps the big labs only.
const PER_PROVIDER = 8
const NOT_FOR_CHAT = /realtime|audio|image|search|transcribe|tts|embed|moderation|daybreak|preview|:|-latest$/
const OPENROUTER_LABS = /^(anthropic|openai|google|deepseek|moonshotai|qwen|z-ai|x-ai)\//

const family = (id: string) =>
  id
    .replace(/^.*\//, "")
    .replace(/-?\d{8}$/, "")
    .replace(/(^|[-.])\d+([.-]\d+)*(?=[-.]|$)/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
const version = (id: string) => (id.replace(/-?\d{8}$/, "").match(/\d+/g) ?? []).map(Number)
function newer(a: Model<Api>, b: Model<Api>) {
  const x = version(a.id)
  const y = version(b.id)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) > (y[i] ?? -1)
  // Same version (Opus, Sonnet and Haiku 5.5): the dearer first, so the strongest leads and the cheapest ends
  if (a.cost.input !== b.cost.input) return a.cost.input > b.cost.input
  return a.id.length < b.id.length
}

// Credentials in one file in the engine's own folder, readable by the user only. Beta keeps them here
// rather than in the keychain: this process runs as plain Node and can't reach Electron's safeStorage.
export class FileCredentials implements CredentialStore {
  private readonly file: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  async read(providerId: string) {
    return (await this.all())[providerId]
  }

  async list(): Promise<CredentialInfo[]> {
    return Object.entries(await this.all()).map(([providerId, c]) => ({ providerId, type: c.type }))
  }

  // pi-ai refreshes OAuth tokens inside modify, so writes run one at a time
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const next = this.chain.then(async () => {
      const all = await this.all()
      const changed = await fn(all[providerId])
      if (changed) all[providerId] = changed
      else delete all[providerId]
      await this.save(all)
      return changed
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  async delete(providerId: string) {
    await this.modify(providerId, async () => undefined)
  }

  private async all(): Promise<Record<string, Credential>> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"))
    } catch {
      return {}
    }
  }

  private async save(all: Record<string, Credential>) {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(all, null, 2), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.file)
  }
}

export function createEngineModels(credentials: CredentialStore): Models {
  const models = createModels({ credentials })
  for (const provider of PROVIDERS) models.setProvider(provider())
  return models
}

// The sign-ins owlit offers: ChatGPT in the browser, then an API key per provider. pi-ai keeps one
// credential per provider, so ChatGPT and an OpenAI key replace each other (both are provider "openai").
export function authMethods(models: Models): AuthMethod[] {
  return [
    { id: CHATGPT, name: "ChatGPT", description: "Uses your ChatGPT plan.", _meta: { owlit: { provider: "openai" } } },
    ...models.getProviders().map((p) => ({ id: `${API_KEY}${p.id}`, name: `${p.name} API key`, _meta: { owlit: { provider: p.id, apiKey: true } } })),
  ]
}

export const providerOf = (methodId: string) => (methodId === CHATGPT ? "openai" : methodId.slice(API_KEY.length))

// What the engine is signed in to, for Settings: one entry per provider, a key by its last four
// characters only
export async function signIns(models: Models, credentials: CredentialStore) {
  const out: { methodId: string; name: string; hint?: string }[] = []
  for (const { providerId, type } of await credentials.list()) {
    const provider = models.getProvider(providerId)
    if (!provider) continue
    if (type === "oauth") {
      out.push({ methodId: providerId === "openai" ? CHATGPT : `${API_KEY}${providerId}`, name: providerId === "openai" ? "ChatGPT" : provider.name })
      continue
    }
    const credential = await credentials.read(providerId)
    const key = credential?.type === "api_key" ? (credential.key ?? "") : ""
    out.push({ methodId: `${API_KEY}${providerId}`, name: `${provider.name} API key`, ...(key ? { hint: key.slice(-4) } : {}) })
  }
  return out
}

// This installation's ID, made on first use and kept: OpenAI's sign-in sends it as the agent host ID and
// expects the same one every time
export async function deviceId(home: string) {
  const file = path.join(home, "device-id")
  try {
    const id = (await readFile(file, "utf8")).trim()
    if (id) return id
  } catch {
    // made below
  }
  const id = randomUUID()
  await mkdir(home, { recursive: true })
  await writeFile(file, id)
  return id
}

export async function signIn(models: Models, credentials: CredentialStore, home: string, methodId: string, meta: Record<string, unknown> | null | undefined, signal: AbortSignal) {
  if (methodId === CHATGPT) {
    const device = await deviceId(home)
    await models.login("openai", "oauth", {
      signal,
      // The flow also offers to paste the code by hand; the browser's callback answers it instead
      prompt: (p) => new Promise((_, reject) => p.signal?.addEventListener("abort", () => reject(new Error("answered in the browser")))),
      notify: (event) => {
        if (event.type === "auth_url") openInBrowser(event.url)
      },
    }, { getDeviceId: () => device, agentName: "Owlit" })
    return
  }
  if (methodId.startsWith(API_KEY)) {
    const provider = methodId.slice(API_KEY.length)
    const key = typeof meta?.apiKey === "string" ? meta.apiKey.trim() : ""
    if (!models.getProvider(provider)) throw new Error(`The engine doesn't know ${provider}.`)
    if (!key) throw new Error("The API key is empty.")
    await credentials.modify(provider, async () => ({ type: "api_key", key }))
    return
  }
  throw new Error(`Unknown sign-in: ${methodId}`)
}

// The models some sign-in reaches, a few per provider, newest first
export async function availableModels(models: Models): Promise<Model<Api>[]> {
  const best = new Map<string, Map<string, Model<Api>>>()
  for (const m of await models.getAvailable()) {
    if (NOT_FOR_CHAT.test(m.id) || (m.provider === "openrouter" && !OPENROUTER_LABS.test(m.id))) continue
    const families = best.get(m.provider) ?? new Map<string, Model<Api>>()
    best.set(m.provider, families)
    const key = m.provider === "openrouter" ? `${m.id.split("/")[0]}/${family(m.id)}` : family(m.id)
    const current = families.get(key)
    if (!current || newer(m, current)) families.set(key, m)
  }
  return [...best.values()].flatMap((families) => [...families.values()].sort((a, b) => (newer(a, b) ? -1 : 1)).slice(0, PER_PROVIDER))
}

export const modelKey = (m: Model<Api>) => `${m.provider}/${m.id}`

function openInBrowser(url: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]]
  spawn(command, args, { stdio: "ignore", detached: true }).unref()
}
