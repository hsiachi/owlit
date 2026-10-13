import { DurableObject } from "cloudflare:workers"

// How often one address may make a new share: one object per address, counting in a sliding window
export class Limiter extends DurableObject<Env> {
  async allow(count: number, windowMs: number): Promise<boolean> {
    const now = Date.now()
    const recent = ((await this.ctx.storage.get<number[]>("hits")) ?? []).filter((at) => now - at < windowMs)
    const allowed = recent.length < count
    if (allowed) recent.push(now)
    await this.ctx.storage.put("hits", recent)
    return allowed
  }
}
