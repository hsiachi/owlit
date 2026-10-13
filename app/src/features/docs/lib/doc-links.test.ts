import { beforeAll, describe, expect, it } from "vitest"
import { useWorkspace } from "@/lib/workspace"
import { useDocsStore } from "../store"
import { docUriOfLink } from "./mentions"

beforeAll(() => {
  useWorkspace.setState({ current: { path: "/Users/x/Owlit", name: "Owlit" } as never })
  const file = { id: "d1", path: "ADHD Support/Literature Review.md", content: "", createdAt: 1, modifiedAt: 1 }
  useDocsStore.setState({ files: { d1: file } } as never)
})

describe("a doc linked by its file", () => {
  it("opens as the doc, however the agent wrote its path", () => {
    const uri = "owlit://docs/ADHD%20Support/Literature%20Review.md"
    expect(docUriOfLink("/Users/x/Owlit/ADHD Support/Literature Review.md")).toBe(uri)
    expect(docUriOfLink("file:///Users/x/Owlit/ADHD%20Support/Literature%20Review.md")).toBe(uri)
    expect(docUriOfLink("ADHD%20Support/Literature%20Review.md")).toBe(uri)
    expect(docUriOfLink("./ADHD Support/Literature Review.md:12")).toBe(uri)
  })

  it("takes /tmp for the /private/tmp it links to", () => {
    useWorkspace.setState({ current: { path: "/private/tmp/ws", name: "ws" } as never })
    expect(docUriOfLink("/tmp/ws/ADHD Support/Literature Review.md")).toBe("owlit://docs/ADHD%20Support/Literature%20Review.md")
    useWorkspace.setState({ current: { path: "/Users/x/Owlit", name: "Owlit" } as never })
  })

  it("is nothing for a web link or a file that isn't in the workspace", () => {
    expect(docUriOfLink("https://example.org/Literature Review.md")).toBeNull()
    expect(docUriOfLink("/Users/x/Elsewhere/Literature Review.md")).toBeNull()
    expect(docUriOfLink("Missing.md")).toBeNull()
    expect(docUriOfLink("#fn-1")).toBeNull()
  })
})
