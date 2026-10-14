import { QUESTION_COLUMN, type Collection } from "@owlit/protocol"

const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

// The collection as a table to open in a spreadsheet: one row per paper, one column per question, with
// how far Owlit read for each answer
export function collectionCsv(c: Collection) {
  const columns = c.columns.filter((col) => !col.hidden)
  const groups = new Map(c.groups.map((g) => [g.id, g.name]))
  const head = ["Paper", "Authors", "Year", "Venue", "DOI", "arXiv", "Group", ...columns.flatMap((col) => [col.id === QUESTION_COLUMN ? "Answer" : col.question, "From"])]
  const lines = c.rows.map((r) => [
    r.paper.title,
    r.paper.authors.join("; "),
    r.paper.year ? String(r.paper.year) : "",
    r.paper.venue ?? "",
    r.paper.ids.doi ?? "",
    r.paper.ids.arxiv ?? "",
    r.group ? (groups.get(r.group) ?? "") : "",
    ...columns.flatMap((col) => {
      const answer = r.cells[col.id]
      if (!answer) return ["", ""]
      const text = answer.rel ? `${answer.rel}: ${answer.text}` : answer.text
      return [text, answer.depth === "full" ? `full text${answer.passage ? `, p. ${answer.passage.page}` : ""}` : "abstract"]
    }),
  ])
  return [head, ...lines].map((l) => l.map(cell).join(",")).join("\n") + "\n"
}

export function downloadCsv(c: Collection) {
  const blob = new Blob([collectionCsv(c)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${c.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "collection"}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
