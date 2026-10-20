import { t } from "@lingui/core/macro"
import { citationLink, cleanName, threadUri, mentionLink, paperUri, QUESTION_COLUMN, uniquePath, type ThreadRead, type ThreadColumn, type ThreadRowRead } from "@owlit/protocol"
import type { NavigateFunction } from "react-router-dom"
import { toast } from "sonner"
import { pathTaken, useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { citeOf, columnLabel, groupByOf, relWord, sectionsOf, shown } from "./lib"

const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

// Excel reads a UTF-8 file without it as the system's legacy encoding (Mac Roman, GBK), garbling every
// accent and every Chinese title
const BOM = "﻿"

// The thread as a table to open in a spreadsheet: one row per paper with what it is, its groups, and a
// column per question with how far Owlit read for each answer
export function threadCsv(c: ThreadRead) {
  const columns = c.columns.filter((col) => !col.hidden && col.kind !== "grouping")
  // A column per grouping with groups, its papers' groups by name
  const groupings = c.columns.filter((col) => col.kind === "grouping" && col.groups?.length)
  const groupsOf = (r: ThreadRowRead, col: ThreadColumn) => (r.in?.[col.id] ?? []).map((id) => col.groups?.find((g) => g.id === id)?.name ?? "").join("; ")
  const head = [
    "Paper",
    "Authors",
    "Year",
    "Venue",
    "DOI",
    "arXiv",
    "What it is",
    ...groupings.map((col) => (groupings.length > 1 ? col.question : "Group")),
    ...columns.flatMap((col) => (col.id === QUESTION_COLUMN ? ["Answer", "Depth"] : [col.question, `Depth (${col.question})`])),
  ]
  const lines = c.rows.map((r) => [
    r.paper.title,
    r.paper.authors.join("; "),
    r.paper.year ? String(r.paper.year) : "",
    r.paper.venue ?? "",
    r.paper.ids.doi ?? "",
    r.paper.ids.arxiv ?? "",
    r.is ?? "",
    ...groupings.map((col) => groupsOf(r, col)),
    ...columns.flatMap((col) => {
      const answer = r.cells[col.id]
      if (!answer) return ["", ""]
      const text = answer.rel ? `${answer.rel}: ${answer.text}` : answer.text
      return [text, answer.depth === "full" ? `full text${answer.passage ? `, p. ${answer.passage.page}` : ""}` : answer.depth === "title" ? "title only" : "abstract"]
    }),
  ])
  return BOM + [head, ...lines].map((l) => l.map(cell).join(",")).join("\n") + "\n"
}

export function downloadCsv(c: ThreadRead) {
  const blob = new Blob([threadCsv(c)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${c.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "thread"}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Markdown keeps a table cell (and a heading) to one line, and | ends the cell
const mdCell = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim()

// The thread as a doc of the user's to write from: its title, the report, and a table of the papers with
// what each is and every answer, under the headings of the grouping the table shows (a subgroup under its
// parent). Papers and the thread stay owlit:// links, so they show as mentions and open; an answer read in
// full ends with its page, cited with the sentence it rests on. Taken as it is now: the doc doesn't follow
// later changes to the thread.
export function threadMarkdown(c: ThreadRead, now = new Date()) {
  const view = shown(c)
  const columns = view.columns.filter((col) => !col.hidden && col.kind !== "grouping")
  const head = `| ${[t({ message: "Paper", comment: "table header in an exported thread" }), t({ message: "What it is", comment: "table column: what kind of paper each is and its material" }), ...columns.map(columnLabel)].map(mdCell).join(" | ")} |`
  const rule = `|${" --- |".repeat(columns.length + 2)}`
  const line = (r: ThreadRowRead) => {
    const paper = `${mentionLink(r.paper.title, paperUri(r.id))} (${citeOf(r.paper)})`
    const answers = columns.map((col) => {
      const cell = r.cells[col.id]
      if (!cell?.text) return ""
      const sentence = col.kind === "compare" ? col.sentences?.find((s) => s.id === cell.sentence) : undefined
      const text = `${cell.rel ? `${relWord(cell.rel)}${sentence ? ` “${sentence.text}”` : ""}: ` : ""}${cell.text}`
      // The page is a citation with the sentence it rests on, so the doc's reader can check it
      return cell.depth === "full" && cell.passage ? `${text} (${citationLink(t({ message: `p. ${cell.passage.page}`, comment: "a page of a paper" }), r.id, cell.passage)})` : text
    })
    return `| ${[paper, r.is ?? "", ...answers].map(mdCell).join(" | ")} |`
  }

  const out = [`# ${c.title}`]
  if (c.report.trim()) out.push(c.report.trim())
  for (const section of sectionsOf(view, groupByOf(view))) {
    if (section.label) out.push(`${"#".repeat(Math.min(2 + section.depth, 6))} ${mdCell(section.label)}`)
    if (section.rows.length) out.push([head, rule, ...section.rows.map(line)].join("\n"))
  }
  const from = mentionLink(c.title, threadUri(c.id))
  const date = now.toLocaleDateString()
  out.push(`*${t({ message: `From the thread ${from}, ${date}.`, comment: "last line of a doc exported from a thread" })}*`)
  return out.join("\n\n") + "\n"
}

// Writes it as a new doc in the thread's project, named after the thread
export function exportAsDoc(c: ThreadRead, navigate: NavigateFunction) {
  const { files, folders, createDocAt } = useDocsStore.getState()
  const path = uniquePath(c.project, cleanName(c.title).slice(0, 80) || t`Thread`, ".md", pathTaken(files, folders))
  const doc = createDocAt(path, threadMarkdown(c))
  if (!doc) return void toast.error(t`owlit couldn't make the doc.`)
  toast(t`Exported as a doc`, {
    description: displayName(doc.path),
    action: { label: t({ message: "Open", comment: "verb: open the exported doc" }), onClick: () => navigate(`/docs/${doc.id}`) },
  })
}
