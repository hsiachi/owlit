import type { ActorId, ChangedPassage, PersonId } from "@owlit/protocol"
import { sha1 } from "../fs-util.ts"
import type { ChangeLog } from "./log.ts"

// One change to a doc, as its texts on each side
export interface DocStep {
  actor: ActorId
  at: number
  before: string
  after: string
}

// Paragraphs are compared whole: a passage changed is one whose paragraph text is new. Lines are the
// editor's ("\n"), so a doc written with "\r\n" finds its paragraphs there too.
const paragraphs = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

// The paragraphs of current that aren't in base, each with the step that last wrote it, leaving out those
// the person wrote themselves. Steps are the doc's changes after base, oldest first; a paragraph no step
// wrote (base and the steps don't meet) is left out too, so a gap in the log shows nothing rather than
// everything.
export function passagesSince(base: string, current: string, steps: DocStep[], me: PersonId): ChangedPassage[] {
  const was = new Set(paragraphs(base))
  const sides = steps.map((s) => ({ step: s, before: new Set(paragraphs(s.before)), after: new Set(paragraphs(s.after)) }))
  const out: ChangedPassage[] = []
  for (const text of new Set(paragraphs(current))) {
    if (was.has(text)) continue
    const by = sides.findLast((s) => s.after.has(text) && !s.before.has(text))?.step
    if (by && by.actor !== me) out.push({ text, actor: by.actor, at: by.at })
  }
  return out
}

// passagesSince for a doc in the log, from the text whose sha1 is hash: the text an entry left, or the
// one it found. Nothing when no entry the log still keeps had that text.
export async function docPassages(log: ChangeLog, rel: string, hash: string, current: string, me: PersonId): Promise<ChangedPassage[]> {
  if (sha1(current) === hash) return []
  const entries = (await log.list({ target: { kind: "doc", path: rel } })).reverse()
  const befores = await Promise.all(entries.map(async (e) => (await log.content(e.id)) ?? ""))
  const steps: DocStep[] = entries.map((e, i) => ({ actor: e.actor, at: e.at, before: befores[i]!, after: i + 1 < entries.length ? befores[i + 1]! : current }))
  for (let i = steps.length - 1; i >= 0; i--) {
    if (entries[i]!.afterHash === hash) return passagesSince(steps[i]!.after, current, steps.slice(i + 1), me)
    if (sha1(steps[i]!.before) === hash) return passagesSince(steps[i]!.before, current, steps.slice(i), me)
  }
  return []
}
