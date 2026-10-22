import type { MemoryLine, Project } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { memoryHeard, memoryNote } from "./rules.ts"

const noon = (day: string) => Date.parse(`${day}T12:00:00`)
const project = (path: string, name: string, parents: string[] = [], draft?: string, day = "2026-10-20"): Project => ({
  path,
  mark: `${path}/project.md`,
  name,
  parents,
  currentDrafts: draft ? [{ kind: draft, path: `${path}/${draft}.md`, modifiedAt: noon(day) }] : [],
})

const proactive = project("Work/Proactive", "Proactive Support", [], "研究故事-v3-委托提醒", "2026-10-21")
const chapter = project("Work/Proactive/Ch2", "Chapter 2", ["Work/Proactive"], "Ch2 draft")
const adhd = project("ADHD", "ADHD Support", [], "Framing-v2")
const thesis = project("Thesis", "Thesis")
const projects = [adhd, thesis, proactive, chapter]

const lines: MemoryLine[] = [
  { id: "m1", kind: "work", text: "Cite as (Author, Year).", at: 1 },
  { id: "m2", kind: "about", text: "I'm a PhD student in HCI.", at: 1 },
  { id: "m3", kind: "about", text: "Scope is the home-care study only.", at: 1, project: "Work/Proactive" },
  { id: "m4", kind: "about", text: "Chapter 2 uses the 2025 interviews.", at: 1, project: "Work/Proactive/Ch2" },
  { id: "m5", kind: "about", text: "The ADHD paper targets CHI.", at: 1, project: "ADHD" },
  { id: "m6", kind: "about", text: "The old survey is paused.", at: 1, project: "Old/Survey" },
]

describe("the memory note", () => {
  it("is the whole list in a workspace with no projects", () => {
    expect(memoryNote({ lines: lines.slice(0, 2), projects: [], chatProjects: [], changed: false })).toBe(
      [
        "[owlit] What owlit keeps in mind about the user (its memory; change it only with memory_write):",
        "How they want you to work:",
        "- [m1] Cite as (Author, Year).",
        "About their work:",
        "- [m2] I'm a PhD student in HCI.",
      ].join("\n"),
    )
  })

  it("gives a chat its projects' lines and their parents' in full, and one line for each other project", () => {
    expect(memoryNote({ lines, projects, chatProjects: [chapter], changed: false })).toBe(
      [
        "[owlit] What owlit keeps in mind about the user (its memory; change it only with memory_write):",
        "How they want you to work:",
        "- [m1] Cite as (Author, Year).",
        "About their work, kept for the workspace:",
        "- [m2] I'm a PhD student in HCI.",
        "- [m6] The old survey is paused. (kept for Old/Survey, which is no project any more)",
        "This chat is in the project Chapter 2 (Work/Proactive/Ch2).",
        "About their work in Chapter 2 (Work/Proactive/Ch2):",
        "- [m4] Chapter 2 uses the 2025 interviews.",
        "About their work in Proactive Support (Work/Proactive), which Chapter 2 is part of:",
        "- [m3] Scope is the home-care study only.",
        "The workspace's other projects, one line each; memory_read(<path>) gives a project's lines when the conversation touches it:",
        "- ADHD Support (ADHD): last worked on Framing-v2, 2026-10-20",
        "- Thesis: nothing yet",
      ].join("\n"),
    )
  })

  it("tells a chat in no project so, with every project as an index line", () => {
    expect(memoryNote({ lines: lines.slice(0, 3), projects: [adhd, proactive], chatProjects: [], changed: true })).toBe(
      [
        "[owlit] What owlit keeps in mind for this chat changed (its memory of the user, or the projects); this is all of it now.",
        "How they want you to work:",
        "- [m1] Cite as (Author, Year).",
        "About their work, kept for the workspace:",
        "- [m2] I'm a PhD student in HCI.",
        "This chat is in no project.",
        "The workspace's projects, one line each; memory_read(<path>) gives a project's lines when the conversation touches it:",
        "- ADHD Support (ADHD): last worked on Framing-v2, 2026-10-20",
        "- Proactive Support (Work/Proactive): last worked on 研究故事-v3-委托提醒, 2026-10-21",
      ].join("\n"),
    )
  })

  it("names both projects of a chat that touched two, a parent once, and says when a project has nothing kept", () => {
    const note = memoryNote({ lines: [], projects, chatProjects: [chapter, adhd, proactive], changed: false })
    expect(note).toContain("This chat is in the projects Chapter 2 (Work/Proactive/Ch2), ADHD Support (ADHD) and Proactive Support (Work/Proactive).")
    expect(note.match(/About their work in Proactive Support/g)).toHaveLength(1)
    expect(note).toContain("About their work in ADHD Support (ADHD):\n(nothing yet)")
    expect(note).toMatch(/one line each; [^\n]*:\n- Thesis: nothing yet$/)
  })
})

describe("what a reply heard", () => {
  it("counts the lines said in full and the other projects given a line, with the chat's projects by name", () => {
    // m1, m2 and m6 (its folder is no project) for every chat; m3 and m4 for Chapter 2 and the project it is in
    expect(memoryHeard({ lines, projects, chatProjects: [chapter] })).toEqual({ projects: [{ path: "Work/Proactive/Ch2", name: "Chapter 2" }], lines: 5, others: 2 })
    expect(memoryHeard({ lines, projects, chatProjects: [] })).toEqual({ projects: [], lines: 3, others: 4 })
    expect(memoryHeard({ lines: lines.slice(0, 2), projects: [], chatProjects: [] })).toEqual({ projects: [], lines: 2, others: 0 })
  })
})
