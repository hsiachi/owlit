import type { Connection, Outcome, PageState } from "./messages.ts"

// What the toolbar button's click does on a tab: the one thing the page asks for, or the reason it
// can't, which is then said (say.ts). Pure, so a test runs it on every page and connection.

// add: the page's paper joins the Library, with the PDF the page names; save: the PDF the page names (or
// the PDF tab itself) goes to the Library paper that lacks it; take: a PDF tab that names no paper is
// handed to owlit, which tells by its first pages whose it is; say: nothing to do but say why
export type Click = { do: "add" } | { do: "save"; paperId: string } | { do: "take" } | { do: "say"; outcome: Outcome }

export function clickPlan({ connection, page }: { connection: Connection; page: PageState | null }): Click {
  if (connection.state === "offline") return say({ kind: "offline" })
  if (connection.state === "elsewhere") return say({ kind: "elsewhere", name: connection.name })
  if (connection.state === "pairing") return say({ kind: "pairing" })
  if (connection.state === "unpaired") return say({ kind: "unpaired" })
  if (connection.workspace === null) return say({ kind: "no-workspace" })
  // The browser's own pages, and a tab gone meanwhile
  if (!page) return say({ kind: "no-paper" })
  const library = page.inLibrary
  if (!library) {
    if (page.paper) return { do: "add" }
    return page.pdfTab ? { do: "take" } : say({ kind: "no-paper" })
  }
  if (library.hasPdf) return say({ kind: "has-pdf", paperId: library.id })
  if (pdfAddress(page)) return { do: "save", paperId: library.id }
  return say({ kind: "none-named", paperId: library.id })
}

// Where the page's PDF is: the address it names, or the tab itself when it shows one
export const pdfAddress = (page: Pick<PageState, "url" | "pdfTab" | "paper">) => page.paper?.pdfUrl ?? (page.pdfTab ? page.url : undefined)

const say = (outcome: Outcome): Click => ({ do: "say", outcome })
