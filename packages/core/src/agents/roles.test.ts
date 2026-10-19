import { describe, expect, it } from "vitest"
import { guardFor, processEnv } from "./profiles.ts"
import type { Role } from "@owlit/protocol"
import type { Target, Who } from "./policy.ts"
import { answerFor } from "./roles.ts"

describe("roles", () => {
  it("runs Claude Code in auto mode, with edits asked or refused and the workspace closed to its shell", () => {
    const assistant = guardFor("claude-code", "assistant", ["/w"])
    expect(assistant.modes).toEqual(["auto", "default"])
    expect(assistant.meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { ask: ["Edit", "Write"] } }, sandbox: { enabled: true, filesystem: { denyWrite: ["/w"] } } } } })
    expect(guardFor("claude-code", "reviewer", ["/w"]).meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { deny: expect.arrayContaining(["Edit", "Write"]) } } } } })
    // A Co-author's options differ from the others', so changing role rebuilds the session
    const coauthor = guardFor("claude-code", "coauthor", ["/w"])
    expect(coauthor.meta).toMatchObject({ claudeCode: { options: { settingSources: [] } } })
    expect(coauthor.meta).not.toEqual(assistant.meta)
  })

  it("keeps owlit's own part of the workspace from Claude Code's editing tools and shell in every role", () => {
    const kept = [".owlit/**", "library/*", "library/**/*.json", "library/**/*.pdf", "library/**/text.md", "library/**/digest.md", "library/**/figures/**", "library/**/sources/**"]
    const own = [...kept.map((p) => `Edit(${p})`), ...kept.map((p) => `Write(${p})`)]
    for (const role of ["reviewer", "assistant", "coauthor"] as const) {
      const options = (guardFor("claude-code", role, ["/w", "/real/w"]).meta as any).claudeCode.options
      expect(options.settings.permissions.deny).toEqual(expect.arrayContaining(own))
      expect(options.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true })
    }
    // A Co-author's shell writes the user's docs, not owlit's state; the others' writes nothing of the workspace
    expect((guardFor("claude-code", "coauthor", ["/w", "/real/w"]).meta as any).claudeCode.options.sandbox.filesystem).toEqual({ denyWrite: ["/w/.owlit", "/w/library", "/real/w/.owlit", "/real/w/library"] })
    expect((guardFor("claude-code", "assistant", ["/w"]).meta as any).claudeCode.options.sandbox.filesystem).toEqual({ denyWrite: ["/w"] })
  })

  it("keeps Claude Code's reads inside the workspace in every role, with papers and owlit's state read through owlit's tools", () => {
    const state = [".owlit/*.*", ".owlit/chats/*.json", ".owlit/docs/**", ".owlit/papers/**", ".owlit/seen/**", ".owlit/shares/**", ".owlit/threads/**", ".owlit/trash/**", ".owlit/versions/**"]
    const papers = ["library/*", "library/**/*.json", "library/**/*.pdf", "library/**/text.md", "library/**/digest.md", "library/**/figures/**", "library/**/sources/**"]
    for (const role of ["reviewer", "assistant", "coauthor"] as const) {
      const permissions = (guardFor("claude-code", role, ["/w"]).meta as any).claudeCode.options.settings.permissions
      expect(permissions.blockReadsOutsideWorkingDirectories).toBe(true)
      expect(permissions.deny).toEqual(expect.arrayContaining([...state, ...papers].map((p) => `Read(${p})`)))
      // The files the user attached, and a paper's note, stay readable
      expect(permissions.deny).not.toContain("Read(.owlit/**)")
      expect(permissions.deny).not.toContain("Read(library/**/note.md)")
    }
  })

  it("keeps each agent's own memory off, whatever the role", () => {
    for (const role of ["reviewer", "assistant", "coauthor"] as const) {
      expect(guardFor("claude-code", role, ["/w"]).meta).toMatchObject({ claudeCode: { options: { settings: { autoMemoryEnabled: false, autoDreamEnabled: false } } } })
    }
    const codex = JSON.parse(processEnv("codex", {}).CODEX_CONFIG)
    expect(codex).toMatchObject({ features: { memories: false }, memories: { generate_memories: false, use_memories: false } })
    // The user's own CODEX_CONFIG stays, with memories turned off on top
    const theirs = JSON.parse(processEnv("codex", { CODEX_CONFIG: JSON.stringify({ model: "o9", features: { memories: true, web: true } }) }).CODEX_CONFIG)
    expect(theirs).toMatchObject({ model: "o9", features: { memories: false, web: true } })
    expect(processEnv("claude-code", {})).toEqual({})
  })

  it("leaves the user's Codex skills, plugins, connectors, hooks and workspace AGENTS.md out", () => {
    const codex = JSON.parse(processEnv("codex", {}).CODEX_CONFIG)
    expect(codex).toMatchObject({
      features: { plugins: false, apps: false, tool_suggest: false, computer_use: false, browser_use: false, in_app_browser: false, hooks: false },
      skills: { include_instructions: false },
      project_doc_max_bytes: 0,
      notify: [],
    })
    // owlit's switches win over the user's own CODEX_CONFIG, and the rest of theirs stays
    const own = { skills: { include_instructions: true, bundled: { enabled: true } }, notify: ["say", "done"], project_doc_max_bytes: 9 }
    const theirs = JSON.parse(processEnv("codex", { CODEX_CONFIG: JSON.stringify(own) }).CODEX_CONFIG)
    expect(theirs).toMatchObject({ skills: { include_instructions: false, bundled: { enabled: true } }, notify: [], project_doc_max_bytes: 0 })
    // A CODEX_CONFIG that isn't JSON is replaced by owlit's
    expect(JSON.parse(processEnv("codex", { CODEX_CONFIG: "{nope" }).CODEX_CONFIG)).toMatchObject({ skills: { include_instructions: false } })
  })

  it("runs Codex read-only unless Owlit is a Co-author", () => {
    expect(guardFor("codex", "reviewer", ["/w"])).toEqual({ modes: ["read-only"] })
    expect(guardFor("codex", "assistant", ["/w"])).toEqual({ modes: ["read-only"] })
    expect(guardFor("codex", "coauthor", ["/w"])).toEqual({ modes: ["agent", "workspace-write"] })
    expect(guardFor("gemini-cli", "assistant", ["/w"])).toEqual({ modes: [] })
  })

  it("answers an engine's request through the policy: a Reviewer's changes refused, an Assistant's edits landing, commands by the role, the rest the user's", () => {
    const who = (role: Role): Who => ({ caller: { kind: "owlit", chatId: "c1" }, actor: "o_12345678", role })
    const doc: Target = { what: "file", files: ["notes.md"] }
    const refused = (answer: unknown) => typeof answer === "object"
    expect(refused(answerFor(who("reviewer"), "edit", doc))).toBe(true)
    expect(refused(answerFor(who("reviewer"), "execute", doc))).toBe(true)
    expect(answerFor(who("reviewer"), "fetch", doc)).toBe("ask")
    expect(answerFor(who("assistant"), "edit", doc)).toBe("allow")
    expect(answerFor(who("assistant"), "delete", doc)).toBe("allow")
    expect(answerFor(who("coauthor"), "edit", doc)).toBe("allow")
    // Commands follow RUNS_COMMANDS; one the role may run is still the user's to allow
    expect(answerFor(who("assistant"), "execute", doc)).toEqual({ refuse: expect.stringMatching(/^Owlit works as Assistant in this chat/) })
    expect(answerFor(who("coauthor"), "execute", doc)).toBe("ask")
    // A change that names no file owlit could check is the user's to decide
    expect(answerFor(who("assistant"), "edit", { what: "file", files: [] })).toBe("ask")
    // owlit's own state is no engine's to change, in any role
    expect(answerFor(who("coauthor"), "edit", { what: "file", files: [".owlit/x.json"], notDoc: true })).toEqual({ refuse: "That file isn't one of the user's docs." })
  })
})
