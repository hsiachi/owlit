import type { Node as PMNode } from "@tiptap/pm/model"
import type { Mentionable } from "@owlit/protocol"

// The composer's document as the message's text, with the items it mentions: paragraphs as lines (a hard
// break as a new line), lists as Markdown ("- ", "1. "; an item's further lines and the lists inside it
// two spaces in), mentions as their @[label] markers. `mentionable`: what a mention node can name.
export function composerText(doc: PMNode, mentionable: Mentionable[]): { text: string; mentions: Mentionable[] } {
  const mentions: Mentionable[] = []
  const inline = (block: PMNode) => {
    let line = ""
    block.descendants((node) => {
      if (node.type.name === "mention") {
        const m = mentionable.find((x) => x.id === node.attrs.id && (!node.attrs.kind || x.kind === node.attrs.kind))
        if (m && !mentions.some((x) => x.id === m.id)) mentions.push(m)
        line += `@[${node.attrs.label}]`
      } else if (node.isText) {
        line += node.text
      } else if (node.type.name === "hardBreak") {
        line += "\n"
      }
      return true
    })
    return line
  }
  const lines: string[] = []
  const blocks = (parent: PMNode, indent: string) => {
    parent.forEach((block) => {
      if (block.type.name !== "bulletList" && block.type.name !== "orderedList") {
        lines.push(...inline(block).split("\n").map((l) => indent + l))
        return
      }
      let n = (block.attrs.start as number | undefined) ?? 1
      block.forEach((item) => {
        const marker = block.type.name === "orderedList" ? `${n++}. ` : "- "
        const first = lines.length
        blocks(item, `${indent}  `)
        // The item's first line takes the marker in place of its indent
        const rest = lines[first]?.slice(indent.length + 2) ?? ""
        lines[first] = rest ? indent + marker + rest : indent + marker.trimEnd()
      })
    })
  }
  blocks(doc, "")
  return { text: lines.join("\n").trim(), mentions }
}
