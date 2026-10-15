import { t } from "@lingui/core/macro"
import {
  interfaceLocale,
  LOCALES,
  normalizeNoteLanguage,
  noteLanguageFor,
  noteLanguageOfLocale,
  PROXY_PRESETS,
  proxyFromLink,
  RpcErrorCode,
  type AppSettings,
  type ProxySettings,
  type SecretName,
  type SettingsCheck,
  type SettingsCheckTarget,
  type SettingsPatch,
  type SettingsView,
} from "@owlit/protocol"
import { z } from "zod"
import type { BrowserHost } from "./host.ts"
import { PUBLISHERS, type PublisherApi } from "./library/publisher-table.ts"
import { OPENALEX_HOST } from "./library/sources/openalex.ts"
import { S2_HOST } from "./library/sources/semanticscholar.ts"
import { tryServer, tryToken } from "./library/parse/mineru.ts"
import { HttpError, type Http } from "./net/http.ts"
import { noParams, RpcFailure, type Router } from "./rpc/index.ts"
import type { SettingsStore } from "./settings.ts"
import { clean } from "./util.ts"

// Where each key the window may set lives in AppSettings
const SECRET_FIELDS = {
  s2ApiKey: ["library", "s2ApiKey"],
  openalexApiKey: ["library", "openalexApiKey"],
  mineruToken: ["parsing", "token"],
  elsevierApiKey: ["library", "elsevierApiKey"],
  wileyTdmToken: ["library", "wileyTdmToken"],
} as const satisfies Record<SecretName, readonly [string, string]>

// The note language a digest is written in when Settings names none: the interface language once one is
// chosen, otherwise the system's own (systemLanguages: BCP 47, most preferred first)
export function defaultNoteLanguage(s: AppSettings, systemLanguages: readonly string[]): string {
  const chosen = s.appearance.language
  return chosen && chosen !== "system" ? noteLanguageOfLocale(chosen) : noteLanguageFor(systemLanguages)
}

export function settingsView(s: AppSettings, systemLanguages: readonly string[] = []): SettingsView {
  const secrets: SettingsView["secrets"] = {}
  for (const [name, [group, key]] of Object.entries(SECRET_FIELDS) as [SecretName, readonly [keyof AppSettings, string]][]) {
    const value = (s[group] as Record<string, unknown>)[key]
    if (typeof value === "string" && value) secrets[name] = value.slice(-4)
  }
  const { library, parsing } = s
  return {
    appearance: s.appearance,
    locale: interfaceLocale(s.appearance.language, systemLanguages),
    profile: s.profile,
    library: clean({
      contactEmail: library.contactEmail,
      proxy: library.proxy,
      proxySignedInAt: library.proxySignedInAt,
      digestLanguage: library.digestLanguage ? normalizeNoteLanguage(library.digestLanguage) : undefined,
      digestLanguageSystem: defaultNoteLanguage(s, systemLanguages),
      digestEveryPaper: library.digestEveryPaper,
    }),
    parsing: clean({ service: parsing.service, url: parsing.url, auto: parsing.auto ?? true }),
    secrets,
    ...clean({ backgroundAgent: s.connectors.background, backgroundModels: s.connectors.backgroundModels }),
    activity: s.activity,
    // Settings from before onboardedAt was kept: a recent workspace means the same
    onboarded: !!s.onboardedAt || s.recentWorkspaces.length > 0,
  }
}

// Sets each field given, and removes each one given as null (back to its default)
function merge<T extends object>(into: T, patch: Record<string, unknown> | undefined): T {
  if (!patch) return into
  const next: Record<string, unknown> = { ...(into as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null || value === "") delete next[key]
    else next[key] = value
  }
  return next as T
}

export function applyPatch(s: AppSettings, patch: SettingsPatch): AppSettings {
  let connectors = patch.backgroundAgent === undefined ? s.connectors : merge(s.connectors, { background: patch.backgroundAgent })
  if (patch.backgroundModel) {
    const models = merge(connectors.backgroundModels ?? {}, { [patch.backgroundModel.agent]: patch.backgroundModel.model })
    connectors = Object.keys(models).length ? { ...connectors, backgroundModels: models } : merge(connectors, { backgroundModels: null })
  }
  return {
    ...s,
    appearance: { ...s.appearance, ...patch.appearance },
    profile: merge(s.profile, patch.profile),
    library: merge(s.library, patch.library),
    parsing: merge(s.parsing, patch.parsing),
    connectors,
  }
}

const nullable = <T extends z.ZodType>(type: T) => type.nullable().optional()
const patchSchema = z.object({
  appearance: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      tone: z.enum(["warm", "neutral", "slate", "sepia"]).optional(),
      language: z.enum(["system", ...LOCALES, "pseudo"]).optional(),
    })
    .optional(),
  profile: z.object({ name: nullable(z.string().trim().max(60)) }).optional(),
  library: z
    .object({
      contactEmail: nullable(z.string().trim().max(320)),
      digestLanguage: nullable(z.string().trim().max(60)),
      digestEveryPaper: z.boolean().optional(),
    })
    .optional(),
  parsing: z
    .object({
      service: nullable(z.enum(["cloud", "self-hosted"])),
      url: nullable(z.string().trim().max(2048)),
      auto: z.boolean().optional(),
    })
    .optional(),
  backgroundAgent: nullable(z.string().min(1)),
  // model is required, as SettingsPatch says; null clears the agent's choice
  backgroundModel: z.object({ agent: z.string().min(1), model: z.string().min(1).nullable() }).optional(),
})
const secretName = z.enum(["s2ApiKey", "openalexApiKey", "mineruToken", "elsevierApiKey", "wileyTdmToken"])
const presetName = z.enum(Object.keys(PROXY_PRESETS) as [keyof typeof PROXY_PRESETS])

interface Deps {
  router: Router
  settings: SettingsStore
  http: Http
  browser?: BrowserHost
  systemLanguages?: readonly string[]
  changed: (view: SettingsView) => void
}

export function registerSettings({ router, settings, http, browser, systemLanguages, changed }: Deps) {
  const save = async (change: (s: AppSettings) => AppSettings) => {
    const view = settingsView(await settings.update(change), systemLanguages)
    changed(view)
    return view
  }

  router.register("settings.get", noParams, async () => settingsView(await settings.get(), systemLanguages))
  router.register("settings.update", z.object({ patch: patchSchema }), ({ patch }) => save((s) => applyPatch(s, patch)))
  router.register("settings.setSecret", z.object({ name: secretName, value: z.string().trim().max(4096).nullable() }), ({ name, value }) =>
    save((s) => {
      const [group, key] = SECRET_FIELDS[name]
      return { ...s, [group]: merge(s[group], { [key]: value }) }
    }),
  )
  router.register("settings.check", z.object({ target: z.enum(["s2ApiKey", "openalexApiKey", "mineruToken", "elsevierApiKey", "wileyTdmToken", "mineruServer"]) }), async ({ target }) =>
    check(http, await settings.get(), target),
  )
  router.register("settings.setProxy", z.object({ preset: presetName.optional(), link: z.string().max(4096).optional() }), ({ preset, link }) => {
    let proxy: ProxySettings | null = null
    if (preset) proxy = { ...PROXY_PRESETS[preset].proxy }
    else if (link?.trim()) {
      proxy = proxyFromLink(link)
      if (!proxy) throw new RpcFailure(RpcErrorCode.InvalidParams, t`That link doesn't show which proxy it went through.`)
    }
    // A different proxy is a different sign-in
    return save((s) => ({ ...s, library: merge(s.library, { proxy, proxySignedInAt: null }) }))
  })
  router.register("settings.proxySignIn", noParams, async () => {
    const proxy = (await settings.get()).library.proxy
    if (!proxy) throw new RpcFailure(RpcErrorCode.InvalidParams, t`No library proxy is set up.`)
    if (!browser) throw new RpcFailure(RpcErrorCode.Unavailable, t`Signing in needs the owlit desktop app.`)
    await browser.showLogin(proxy.base)
    return save((s) => ({ ...s, library: { ...s.library, proxySignedInAt: Date.now() } }))
  })
}

// Each service answers a bad key in its own way; anything that isn't clearly a refusal counts as
// "couldn't tell", so a busy service never makes a good key look wrong
async function check(http: Http, s: AppSettings, target: SettingsCheckTarget): Promise<SettingsCheck> {
  if (target === "mineruServer") {
    if (s.parsing.service !== "self-hosted") return { result: "unknown" }
    const url = s.parsing.url ?? "http://127.0.0.1:8000"
    return (await tryServer(http, s.parsing)) ? { result: "works" } : { result: "rejected", message: t`Nothing answers at ${url}. Is MinerU running?` }
  }
  if (target === "mineruToken") {
    if (!s.parsing.token) return { result: "unknown" }
    switch (await tryToken(http, { ...s.parsing, service: "cloud" })) {
      case "works":
        return { result: "works" }
      case "quota":
        return { result: "works", message: t`Today's MinerU quota is used up. Papers keep their built-in text until tomorrow.` }
      case "rejected":
        return { result: "rejected", message: t`MinerU says this token isn't valid. Check it was copied whole.` }
      case "unreachable":
        return { result: "unknown", message: t`Couldn't reach MinerU to check the token. It will be tried on the next paper.` }
    }
  }
  if (target === "elsevierApiKey" || target === "wileyTdmToken") return checkPublisherKey(http, s, target)
  const key = target === "s2ApiKey" ? s.library.s2ApiKey : s.library.openalexApiKey
  if (!key) return { result: "unknown" }
  const service = target === "s2ApiKey" ? "Semantic Scholar" : "OpenAlex"
  const url =
    target === "s2ApiKey"
      ? `https://${S2_HOST}/graph/v1/paper/arXiv:1706.03762?fields=title`
      : `https://${OPENALEX_HOST}/works?per-page=1&api_key=${encodeURIComponent(key)}`
  try {
    const response = await http.get(url, { headers: target === "s2ApiKey" ? { "x-api-key": key } : undefined, retries: 0, timeoutMs: 15_000 })
    await response.body?.cancel().catch(() => {})
    return { result: "works" }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      return { result: "rejected", message: t`${service} says this key isn't valid. Check it was copied whole.` }
    }
    if (error instanceof HttpError && error.status === 429) return { result: "unknown", message: t`${service} is busy; the key will be tried on the next lookup.` }
    return { result: "unknown", message: t`Couldn't reach ${service} to check the key.` }
  }
}

// A publisher's key works when its API takes it; whether this network has the subscription is a second
// question, which Elsevier answers outright and Wiley by handing over a paywalled paper or not
async function checkPublisherKey(http: Http, s: AppSettings, target: "elsevierApiKey" | "wileyTdmToken"): Promise<SettingsCheck> {
  const elsevier = target === "elsevierApiKey"
  const api = PUBLISHERS.find((p) => p.api?.key === target)!.api!
  const key = s.library[target]
  if (!key) return { result: "unknown" }
  const service = elsevier ? "Elsevier" : "Wiley"
  try {
    if (elsevier) {
      const answer = await http.json<{ "entitlement-response"?: { "document-entitlement"?: { entitled?: boolean } } }>(
        `https://${api.host}/content/article/entitlement/doi/${api.checkDoi}`,
        { headers: { [api.header]: key }, retries: 0, timeoutMs: 15_000 },
      )
      if (answer["entitlement-response"]?.["document-entitlement"]?.entitled === false) {
        return { result: "works", message: t`The key works, but Elsevier sees no subscription from this network. On the university's network it will.` }
      }
      return { result: "works" }
    }
    const response = await http.get(api.url(api.checkDoi), { headers: { [api.header]: key }, retries: 0, timeoutMs: 30_000 })
    await response.body?.cancel().catch(() => {})
    return { result: "works" }
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return { result: "rejected", message: t`${service} says this key isn't valid. Check it was copied whole.` }
    if (error instanceof HttpError && error.status === 403) {
      return elsevier
        ? checkElsevierOffNetwork(http, api, key)
        : { result: "unknown", message: t`Wiley refused: either the token isn't valid or it sees no subscription from this network.` }
    }
    if (error instanceof HttpError && error.status === 429) return { result: "unknown", message: t`${service} is busy; the key will be tried on the next paper.` }
    return { result: "unknown", message: t`Couldn't reach ${service} to check the key.` }
  }
}

// Elsevier answers a key it doesn't know with 401, and a known key asking from outside a subscribing
// network with 403 ("Requestor configuration settings insufficient"), even for the entitlement question
// (2026-10-15, off campus with a split-tunnel campus VPN that doesn't carry api.elsevier.com). Its
// abstract API needs no subscription, so it tells a sound key on the wrong network from a refused one.
async function checkElsevierOffNetwork(http: Http, api: PublisherApi, key: string): Promise<SettingsCheck> {
  try {
    const response = await http.get(`https://${api.host}/content/abstract/doi/${api.checkDoi}`, {
      headers: { [api.header]: key, accept: "application/json" },
      retries: 0,
      timeoutMs: 15_000,
    })
    await response.body?.cancel().catch(() => {})
    return { result: "works", message: t`The key works, but Elsevier sees no subscription from this network. On the university's network it will.` }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      return { result: "rejected", message: t`Elsevier refused this key. Check it was copied whole.` }
    }
    return { result: "unknown", message: t`Elsevier sees no subscription from this network, and couldn't be asked whether the key itself works.` }
  }
}
