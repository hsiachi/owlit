import { isOwlit, type ActivityAnswer } from "@owlit/protocol"
import { z } from "zod"
import { wearOf } from "../library/wear.ts"
import type { Notifier, Router } from "../rpc/index.ts"
import { settingsView } from "../settings/rpc.ts"
import type { SettingsStore } from "../settings/store.ts"
import type { Workspace } from "../workspace/workspace.ts"
import type { ActivityBus } from "./bus.ts"
import { answerActivity } from "./query.ts"
import { readJournal } from "./reading.ts"
import { activityEvent, activityQuery } from "./schema.ts"

interface Deps {
  router: Router
  notifier: Notifier
  settings: SettingsStore
  activity: ActivityBus
  // The open workspace, or none
  workspace: () => Workspace | null
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // The system's preferred languages, for the settings view a change here sends out
  systemLanguages: readonly string[]
}

export function registerActivity({ router, notifier, settings, activity, workspace, requireWorkspace, systemLanguages }: Deps) {
  // Turned off, the journal keeps nothing (see Journal), but Owlit's rules still hear what the user opens
  router.register("activity.emit", z.object({ event: activityEvent }), "admin", async ({ event }) => {
    await settings.get()
    if (workspace()) activity.publish(event)
    return null
  })
  // What the user did lately, for an agent: nothing at all while recording is turned off
  router.register("activity.query", z.object({ query: activityQuery }), "read", async ({ query }): Promise<ActivityAnswer> => {
    const ws = requireWorkspace()
    if (!(await settings.get()).activity.enabled) return { recording: false }
    const [{ papers, aliases }, chats, entries, docChanges] = await Promise.all([
      ws.library.list(),
      ws.chats.list(),
      readJournal(ws.owlitPath("journal.jsonl")),
      ws.changes.list({ target: { kind: "doc" } }),
    ])
    const titles = new Map(papers.map((p) => [p.id, p.title]))
    const chatTitles = new Map(chats.map((c) => [c.id, c.title]))
    const alias = (id: string) => aliases[id] ?? id
    const changes = docChanges.filter((c) => isOwlit(c.actor)).reverse()
    const statuses = new Map(papers.map((p) => [p.id, p.status]))
    const answer = answerActivity(entries, query, { now: Date.now(), names: { paper: (id) => titles.get(id), chat: (id) => chatTitles.get(id) }, alias, changes, status: (id) => statuses.get(id) })
    // A paper's history also says which of its sentences Owlit's answers rested on
    if (query.mode === "of" && query.paper) {
      const { cited } = await wearOf(query.paper, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases })
      if (cited.length) return { recording: true, ...answer, cited: cited.map(({ quote, page, chatId, chatTitle, at }) => ({ quote, ...(page ? { page } : {}), chatId, chatTitle, at })) }
    }
    return { recording: true, ...answer }
  })
  router.register("activity.setEnabled", z.object({ enabled: z.boolean() }), "admin", async ({ enabled }) => {
    const next = await settings.update((s) => ({ ...s, activity: { ...s.activity, enabled } }))
    notifier.notify("settings.changed", settingsView(next, systemLanguages, settings.unopenedKeys()))
    return next.activity
  })
}
