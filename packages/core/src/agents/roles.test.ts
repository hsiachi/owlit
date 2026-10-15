import { describe, expect, it } from "vitest"
import { guardFor, processEnv } from "./profiles.ts"
import { answerFor, consentFor } from "./roles.ts"

describe("roles", () => {
  it("runs Claude Code in auto mode, with edits asked or refused and the workspace closed to its shell", () => {
    const assistant = guardFor("claude-code", "assistant", ["/w"])
    expect(assistant.modes).toEqual(["auto", "default"])
    expect(assistant.meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { ask: ["Edit", "Write"] } }, sandbox: { enabled: true, filesystem: { denyWrite: ["/w"] } } } } })
    expect(guardFor("claude-code", "reviewer", ["/w"]).meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { deny: ["Edit", "Write"] } } } } })
    // A Co-author's options differ from the others', so changing role rebuilds the session
    const coauthor = guardFor("claude-code", "coauthor", ["/w"])
    expect(coauthor.meta).toMatchObject({ claudeCode: { options: { settingSources: [] } } })
    expect(coauthor.meta).not.toEqual(assistant.meta)
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

  it("refuses a Reviewer's changes and leaves the rest to the user", () => {
    expect(answerFor("reviewer", "edit")).toBe("reject")
    expect(answerFor("reviewer", "execute")).toBe("reject")
    expect(answerFor("reviewer", "fetch")).toBe("ask")
    expect(answerFor("assistant", "edit")).toBe("ask")
    expect(answerFor("coauthor", "execute")).toBe("ask")
  })

  it("lets an Assistant add papers but asks before deleting or moving; a Co-author just goes ahead", () => {
    expect(consentFor("reviewer", "add_paper")).toHaveProperty("refuse")
    expect(consentFor("assistant", "add_paper")).toBe("allow")
    expect(consentFor("assistant", "delete")).toBe("ask")
    expect(consentFor("assistant", "move")).toBe("ask")
    expect(consentFor("coauthor", "delete")).toBe("allow")
  })
})
