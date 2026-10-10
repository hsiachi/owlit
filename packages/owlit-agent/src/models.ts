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
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const PROVIDERS: (() => Provider)[] = [openaiProvider, anthropicProvider, openrouterProvider, deepseekProvider, qwenTokenPlanCnProvider, moonshotaiCnProvider]

export const CHATGPT = "chatgpt"
const API_KEY = "api-key:"

// How many models of each provider the picker shows: the catalog lists dozens (OpenRouter hundreds),
// oldest first, including ones for audio, images or search that a chat can't use
const PER_PROVIDER = 6
const NOT_FOR_CHAT = /realtime|audio|image|search|transcribe|tts|embed|moderation|daybreak|-pro$|nano/

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

// The sign-ins owlit offers: ChatGPT in the browser, then an API key per provider
export function authMethods(models: Models): AuthMethod[] {
  return [
    { id: CHATGPT, name: "Sign in with ChatGPT", description: "Uses your ChatGPT plan." },
    ...models.getProviders().map((p) => ({ id: `${API_KEY}${p.id}`, name: `${p.name} API key`, _meta: { owlit: { provider: p.id, apiKey: true } } })),
  ]
}

export async function signIn(models: Models, credentials: CredentialStore, methodId: string, meta: Record<string, unknown> | null | undefined, signal: AbortSignal) {
  if (methodId === CHATGPT) {
    await models.login("openai", "oauth", {
      signal,
      // The flow also offers to paste the code by hand; the browser's callback answers it instead
      prompt: (p) => new Promise((_, reject) => p.signal?.addEventListener("abort", () => reject(new Error("answered in the browser")))),
      notify: (event) => {
        if (event.type === "auth_url") openInBrowser(event.url)
      },
    })
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

// The models some sign-in reaches, a few per provider, newest last
export async function availableModels(models: Models): Promise<Model<Api>[]> {
  const available = await models.getAvailable()
  const byProvider = new Map<string, Model<Api>[]>()
  for (const m of available) {
    if (NOT_FOR_CHAT.test(m.id)) continue
    byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m])
  }
  return [...byProvider.values()].flatMap((list) => list.slice(-PER_PROVIDER))
}

export const modelKey = (m: Model<Api>) => `${m.provider}/${m.id}`

function openInBrowser(url: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]]
  spawn(command, args, { stdio: "ignore", detached: true }).unref()
}
