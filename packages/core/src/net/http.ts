// core's one way out to the network. Every request goes through the host's fetch (the system's proxy
// and certificates), waits its turn for its host (each API has its own rate), times out, and is tried
// again when the failure is the kind that passes: a dropped connection, 429, 5xx.

export interface HostLimit {
  // Requests started per second, at most
  perSecond: number
  // Requests in flight at once, at most
  concurrent?: number
}

export interface RequestOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  // Further tries after a passing failure; default 3
  retries?: number
  // Per try; default 30s
  timeoutMs?: number
}

// A response that isn't a success, or no response at all (status 0)
export class HttpError extends Error {
  readonly status: number
  readonly url: string
  constructor(status: number, url: string, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.url = url
  }
}

interface Gate {
  limit: HostLimit
  nextStart: number
  inFlight: number
  waiting: (() => void)[]
}

const DEFAULT_LIMIT: HostLimit = { perSecond: 5, concurrent: 4 }

export class Http {
  private readonly fetch: typeof fetch
  private readonly userAgent: string
  private readonly retryBaseMs: number
  private gates = new Map<string, Gate>()

  constructor(options: { fetch?: typeof fetch; userAgent: string; retryBaseMs?: number }) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.userAgent = options.userAgent
    this.retryBaseMs = options.retryBaseMs ?? 1000
  }

  // Sets a host's rate (api.openalex.org, api.semanticscholar.org, …)
  limit(host: string, limit: HostLimit) {
    this.gateFor(host).limit = limit
  }

  async json<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.get(url, { ...options, headers: { accept: "application/json", ...options.headers } })
    return (await response.json()) as T
  }

  async text(url: string, options: RequestOptions = {}): Promise<string> {
    return (await this.get(url, options)).text()
  }

  // A successful response, body unread. 4xx other than 429 is final; 404 says "not there".
  async get(url: string, options: RequestOptions = {}): Promise<Response> {
    const retries = options.retries ?? 3
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted()
      let wait: number
      try {
        const response = await this.once(url, options)
        if (response.ok) return response
        await response.body?.cancel().catch(() => {})
        if (response.status !== 429 && response.status < 500) throw new HttpError(response.status, url, describe(response.status, url))
        if (attempt >= retries) throw new HttpError(response.status, url, describe(response.status, url))
        wait = retryAfter(response) ?? this.retryBaseMs * 2 ** attempt
      } catch (error) {
        if (error instanceof HttpError || options.signal?.aborted) throw error
        if (attempt >= retries) throw new HttpError(0, url, `Couldn't reach ${hostOf(url)}.`)
        wait = this.retryBaseMs * 2 ** attempt
      }
      await sleep(wait, options.signal)
    }
  }

  private async once(url: string, options: RequestOptions) {
    const release = await this.enter(hostOf(url), options.signal)
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    try {
      return await this.fetch(url, { headers: { "user-agent": this.userAgent, ...options.headers }, signal, redirect: "follow" })
    } finally {
      release()
    }
  }

  // Resolves when this host may take another request; the returned function frees the slot
  private async enter(host: string, signal?: AbortSignal): Promise<() => void> {
    const gate = this.gateFor(host)
    const concurrent = gate.limit.concurrent ?? Infinity
    while (gate.inFlight >= concurrent) {
      await new Promise<void>((resolve) => gate.waiting.push(resolve))
      signal?.throwIfAborted()
    }
    gate.inFlight++
    const now = Date.now()
    const start = Math.max(now, gate.nextStart)
    gate.nextStart = start + 1000 / gate.limit.perSecond
    try {
      if (start > now) await sleep(start - now, signal)
    } catch (error) {
      this.leave(gate)
      throw error
    }
    return () => this.leave(gate)
  }

  private leave(gate: Gate) {
    gate.inFlight--
    gate.waiting.shift()?.()
  }

  private gateFor(host: string) {
    let gate = this.gates.get(host)
    if (!gate) {
      gate = { limit: DEFAULT_LIMIT, nextStart: 0, inFlight: 0, waiting: [] }
      this.gates.set(host, gate)
    }
    return gate
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function describe(status: number, url: string) {
  const host = hostOf(url)
  if (status === 404) return `${host} has no record of that.`
  if (status === 401 || status === 403) return `${host} refused the request.`
  if (status === 429) return `${host} is asking owlit to slow down.`
  if (status >= 500) return `${host} is having trouble right now.`
  return `${host} answered ${status}.`
}

// Retry-After in seconds or as a date, capped at a minute
function retryAfter(response: Response) {
  const header = response.headers.get("retry-after")
  if (!header) return undefined
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : undefined
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}
