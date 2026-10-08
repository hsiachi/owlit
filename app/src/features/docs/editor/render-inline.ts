import katex from "katex"

// Draws a line of Markdown inside a rendered block (a table cell): mentions, links, wikilinks, bold,
// italics, code and math. Anything else stays as written.
const TOKEN = /(\[[^\]]*\]\([^)\s]+\))|(\[\[[^\]]+\]\])|(\*\*[^*]+\*\*)|(`[^`]+`)|(\$[^$\s](?:[^$]*[^$\s])?\$)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

export function renderInline(text: string, into: HTMLElement) {
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    into.append(text.slice(last, m.index))
    last = m.index + m[0].length
    const [whole, link, wiki, bold, code, math] = m
    if (link) {
      const [, label, href] = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(link) ?? []
      const el = document.createElement(href?.startsWith("owlit://") ? "span" : "a")
      el.className = href?.startsWith("owlit://") ? "cm-mention" : "cm-link"
      if (href?.startsWith("owlit://")) el.dataset.uri = href
      else (el as HTMLAnchorElement).href = href ?? ""
      el.textContent = label ?? ""
      into.append(el)
    } else if (wiki) {
      const inner = wiki.slice(2, -2)
      const el = document.createElement("span")
      el.className = "cm-wikilink"
      el.textContent = inner.split("|").pop() ?? inner
      into.append(el)
    } else if (bold) {
      const el = document.createElement("strong")
      el.textContent = bold.slice(2, -2)
      into.append(el)
    } else if (code) {
      const el = document.createElement("code")
      el.className = "cm-inline-code"
      el.textContent = code.slice(1, -1)
      into.append(el)
    } else if (math) {
      const el = document.createElement("span")
      katex.render(math.slice(1, -1), el, { throwOnError: false })
      into.append(el)
    } else {
      const el = document.createElement("em")
      el.textContent = whole.slice(1, -1)
      into.append(el)
    }
  }
  into.append(text.slice(last))
}
