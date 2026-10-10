import { describe, expect, it } from "vitest"
import { answerFor, consentFor, guardFor } from "./roles.ts"

describe("roles", () => {
  it("runs Claude Code in auto mode, with edits asked or refused and the workspace closed to its shell", () => {
    const assistant = guardFor("claude-code", "assistant", ["/w"])
    expect(assistant.modes).toEqual(["auto", "default"])
    expect(assistant.meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { ask: ["Edit", "Write"] } }, sandbox: { enabled: true, filesystem: { denyWrite: ["/w"] } } } } })
    expect(guardFor("claude-code", "reviewer", ["/w"]).meta).toMatchObject({ claudeCode: { options: { settings: { permissions: { deny: ["Edit", "Write"] } } } } })
    // A Co-author's options differ from the others', so changing role rebuilds the session
    const coauthor = guardFor("claude-code", "coauthor", ["/w"])
    expect(coauthor.meta).toEqual({ claudeCode: { options: {} } })
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
