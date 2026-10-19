import { t } from "@lingui/core/macro"
import { cleanName, threadUri, mentionLink, paperUri, QUESTION_COLUMN, uniquePath, type Thread, type ThreadColumn, type ThreadRow } from "@owlit/protocol"
import type { NavigateFunction } from "react-router-dom"
import { toast } from "sonner"
import { pathTaken, useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { citeOf, columnLabel, relWord } from "./lib"

const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

// The thread as a table to open in a spreadsheet: one row per paper, one column per question, with
// how far Owlit read for each answer
function threadCsv(c: Thread) {
  const columns = c.columns.filter((col) => !col.hidden && col.kind !== "grouping")
  // A column per grouping with groups, its papers' groups by name
  const groupings = c.columns.filter((col) => col.kind === "grouping" && col.groups?.length)
  const groupsOf = (r: ThreadRow, col: ThreadColumn) => (r.in?.[col.id] ?? []).map((id) => col.groups?.find((g) => g.id === id)?.name ?? "").join("; ")
  const head = ["Paper", "Authors", "Year", "Venue", "DOI", "arXiv", ...groupings.map((col) => (groupings.length > 1 ? col.question : "Group")), ...columns.flatMap((col) => [col.id === QUESTION_COLUMN ? "Answer" : col.question, "From"])]
  const lines = c.rows.map((r) => [
    r.paper.title,
    r.paper.authors.join("; "),
    r.paper.year ? String(r.paper.year) : "",
    r.paper.venue ?? "",
    r.paper.ids.doi ?? "",
    r.paper.ids.arxiv ?? "",
    ...groupings.map((col) => groupsOf(r, col)),
    ...columns.flatMap((col) => {
      const answer = r.cells[col.id]
      if (!answer) return ["", ""]
      const text = answer.rel ? `${answer.rel}: ${answer.text}` : answer.text
      return [text, answer.depth === "full" ? `full text${answer.passage ? `, p. ${answer.passage.page}` : ""}` : answer.depth === "title" ? "title only" : "abstract"]
    }),
  ])
  return [head, ...lines].map((l) => l.map(cell).join(",")).join("\n") + "\n"
}

export function downloadCsv(c: Thread) {
  const blob = new Blob([threadCsv(c)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${c.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "thread"}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Markdown keeps a table cell to one line, and | ends the cell
const mdCell = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim()

// The thread as a doc of the user's to write from: its title, the memo, and a table per group of
// the papers with every answer. Papers and the thread stay owlit:// links, so they show as mentions
// and open; an answer read in full ends with its page. Taken as it is now: the doc doesn't follow later
// changes to the thread.
export function threadMarkdown(c: Thread, now = new Date()) {
  const columns = c.columns.filter((col) => !col.hidden && col.kind !== "grouping")
  const head = `| ${[t({ message: "Paper", comment: "table header in an exported thread" }), ...columns.map(columnLabel)].map(mdCell).join(" | ")} |`
  const rule = `|${" --- |".repeat(columns.length + 1)}`
  const line = (r: ThreadRow) => {
    const paper = `${mentionLink(r.paper.title, paperUri(r.id))} (${citeOf(r.paper)})`
    const answers = columns.map((col) => {
      const cell = r.cells[col.id]
      if (!cell?.text) return ""
      const sentence = col.kind === "compare" ? col.sentences?.find((s) => s.id === cell.sentence) : undefined
      const text = `${cell.rel ? `${relWord(cell.rel)}${sentence ? ` “${sentence.text}”` : ""}: ` : ""}${cell.text}`
      return cell.depth === "full" && cell.passage ? `${text} (p. ${cell.passage.page})` : text
    })
    return `| ${[paper, ...answers].map(mdCell).join(" | ")} |`
  }
  const table = (rows: ThreadRow[]) => [head, rule, ...rows.map(line)].join("\n")

  const out = [`# ${c.title}`]
  if (c.memo.length) out.push(c.memo.map((s) => `- ${s.text}`).join("\n"))
  // The first grouping's groups as headings, a subgroup under its parent (a paper in two groups is under
  // both); papers in no group after them
  const grouping = c.columns.find((col) => col.kind === "grouping" && col.groups?.length)
  const groups = grouping?.groups ?? []
  const placed = new Set<string>()
  const section = (parent: string | undefined, level: number) => {
    for (const g of groups.filter((g) => g.parent === parent)) {
      const rows = c.rows.filter((r) => r.in?.[grouping!.id]?.includes(g.id))
      const nested = groups.some((o) => o.parent === g.id)
      if (!rows.length && !nested) continue
      out.push(`${"#".repeat(level)} ${g.name}`)
      if (rows.length) out.push(table(rows))
      rows.forEach((r) => placed.add(r.id))
      section(g.id, Math.min(level + 1, 6))
    }
  }
  section(undefined, 2)
  const rest = c.rows.filter((r) => !placed.has(r.id))
  if (rest.length) {
    if (placed.size) out.push(`## ${t({ message: "Other papers", comment: "heading in an exported thread: papers in no group" })}`)
    out.push(table(rest))
  }
  const from = mentionLink(c.title, threadUri(c.id))
  const date = now.toLocaleDateString()
  out.push(`*${t({ message: `From the thread ${from}, ${date}.`, comment: "last line of a doc exported from a thread" })}*`)
  return out.join("\n\n") + "\n"
}

// Writes it as a new doc in the thread's project, named after the thread
export function exportAsDoc(c: Thread, navigate: NavigateFunction) {
  const { files, folders, createDocAt } = useDocsStore.getState()
  const path = uniquePath(c.project, cleanName(c.title).slice(0, 80) || t`Thread`, ".md", pathTaken(files, folders))
  const doc = createDocAt(path, threadMarkdown(c))
  if (!doc) return void toast.error(t`owlit couldn't make the doc.`)
  toast(t`Exported as a doc`, {
    description: displayName(doc.path),
    action: { label: t({ message: "Open", comment: "verb: open the exported doc" }), onClick: () => navigate(`/docs/${doc.id}`) },
  })
}
