import { t } from "@lingui/core/macro"
import { RpcErrorCode, type WorkspaceInfo, type WorkspaceState } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { z } from "zod"
import { isMissing } from "../fs-util.ts"
import { noParams, RpcFailure, type Router } from "../rpc/index.ts"
import type { SettingsStore } from "../settings.ts"
import { copyExample } from "./example.ts"
import { createFolder, suggestFolder } from "./welcome.ts"
import type { Workspace } from "./workspace.ts"

interface Deps {
  router: Router
  settings: SettingsStore
  // The open workspace, or none
  workspace: () => Workspace | null
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // Opens a folder as the workspace (Core.openWorkspace)
  open: (folder: string) => Promise<WorkspaceInfo>
  // What is open and whether an open is under way
  state: () => WorkspaceState
  // The example workspace the app ships (CoreOptions.exampleDir)
  exampleDir?: string
}

export function registerWorkspace({ router, settings, workspace, requireWorkspace, open, state, exampleDir }: Deps) {
  router.register("workspace.current", noParams, "read", () => workspace()?.info ?? null)
  router.register("workspace.open", z.object({ path: z.string().min(1) }), "admin", ({ path }) => open(path))
  router.register("workspace.recent", noParams, "read", async () => {
    const { recentWorkspaces } = await settings.get()
    return recentWorkspaces.filter((p) => !isMissing(p)).map(toInfo)
  })
  router.register("workspace.state", noParams, "read", () => state())
  router.register("workspace.welcome", noParams, "read", async () => {
    const { recentWorkspaces } = await settings.get()
    return { recent: recentWorkspaces.map((p) => ({ ...toInfo(p), missing: isMissing(p) })), suggestion: suggestFolder() }
  })
  router.register("workspace.create", z.object({ parent: z.string().min(1), name: z.string() }), "admin", async ({ parent, name }) =>
    open(await createFolder(parent, name)),
  )
  router.register("workspace.createExample", noParams, "admin", async () => {
    const source = exampleDir
    if (!source || !existsSync(source)) throw new RpcFailure(RpcErrorCode.NotFound, t`This copy of owlit has no example workspace.`)
    return open(await copyExample(source, suggestFolder().parent, (await settings.get()).profile.id!))
  })
  router.register("workspace.forget", z.object({ path: z.string().min(1) }), "admin", async ({ path }) => {
    await settings.forgetWorkspace(path)
    return null
  })
  router.register("workspace.clearRecent", noParams, "admin", async () => {
    await settings.update((s) => ({ ...s, recentWorkspaces: [] }))
    return null
  })

  router.register("workspace.layout", noParams, "read", () => requireWorkspace().layout())
  router.register("workspace.setLayout", z.object({ patch: z.record(z.string(), z.unknown()) }), "admin", ({ patch }) =>
    requireWorkspace().setLayout(patch),
  )

  const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
}
