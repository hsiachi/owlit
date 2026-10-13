import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Every message the code says has its Chinese, with the same placeholders. A message without one falls
// back to English at run time, so this is the only place a forgotten translation shows up.

interface Entry {
  id: string
  str: string
}

const unquote = (line: string) => JSON.parse(line.slice(line.indexOf('"')))

function readPo(locale: string): Entry[] {
  const text = readFileSync(path.join(import.meta.dirname, "../locales", `${locale}.po`), "utf8")
  const entries: Entry[] = []
  for (const block of text.split(/\n\n+/)) {
    let id = ""
    let str = ""
    let field: "id" | "str" | null = null
    for (const line of block.split("\n")) {
      if (line.startsWith("#~")) {
        field = null
        continue
      }
      if (line.startsWith("msgid ")) [field, id] = ["id", unquote(line)]
      else if (line.startsWith("msgstr ")) [field, str] = ["str", unquote(line)]
      else if (line.startsWith('"') && field === "id") id += unquote(line)
      else if (line.startsWith('"') && field === "str") str += unquote(line)
    }
    if (id) entries.push({ id, str })
  }
  return entries
}

// The names a message fills in: {name}, and the variable of {count, plural, …} with those inside its forms;
// a form's own text ("one {line}") is words, not a name. ICU's grammar, read just far enough for that.
function placeholders(message: string) {
  const names = new Set<string>()
  let i = 0
  // Text until the closing brace of the form we are in (or the end)
  const text = () => {
    while (i < message.length && message[i] !== "}") {
      // An apostrophe quotes only before a brace or #; in "Don't" it is a letter
      if (message[i] === "'" && /[{}#]/.test(message[i + 1] ?? "")) i = message.indexOf("'", i + 1) + 1 || message.length
      else if (message[i] === "{") argument()
      else i++
    }
  }
  const argument = () => {
    i++
    const head = /^\s*(\w+)\s*(?:,\s*(\w+))?\s*,?/.exec(message.slice(i))!
    names.add(head[1])
    i += head[0].length
    if (head[2] && /^(plural|select|selectordinal)$/.test(head[2])) {
      // key {form} key {form} …
      while (i < message.length && message[i] !== "}") {
        const open = message.indexOf("{", i)
        if (open < 0) break
        i = open + 1
        text()
        i++
      }
    } else {
      i = message.indexOf("}", i)
    }
    i++
  }
  text()
  return [...names].sort()
}

describe("catalogs", () => {
  const source = readPo("en")

  it("have English for every message", () => {
    expect(source.length).toBeGreaterThan(0)
  })

  it("have Simplified Chinese for every message, with the same placeholders", () => {
    const zh = new Map(readPo("zh-Hans").map((e) => [e.id, e.str]))
    const missing = source.filter((e) => !zh.get(e.id)).map((e) => e.id)
    expect(missing).toEqual([])
    const mismatched = source.filter((e) => zh.get(e.id) && placeholders(zh.get(e.id)!).join() !== placeholders(e.str || e.id).join()).map((e) => `${e.id} → ${zh.get(e.id)}`)
    expect(mismatched).toEqual([])
  })
})
