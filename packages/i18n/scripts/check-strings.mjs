// pnpm lint: finds English the renderer would show without going through Lingui, so it can't slip back
// in. It looks at JSX text and at the props that hold words (placeholder, title, aria-label, label …)
// written as plain strings, outside <Trans>. In every file of the app, main and core it also finds t`…`
// and plural() said at a module's top level: that runs once on import, before a language is chosen, and
// stays English (a table of words is a function, or msg`…` said where it shows). A string that must stay as it is (a name, a symbol shown on
// its own) is let through by a `i18n-ignore` comment on its line or the line above.
//
// node packages/i18n/scripts/check-strings.mjs [dir…]   (default: app/src, apps/desktop/src, apps/share-web/src, packages/core/src)

import { readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const ts = createRequire(path.join(root, "app/package.json"))("typescript")

// Props whose plain-string value is shown to the user
const WORDY_PROPS = new Set(["placeholder", "title", "aria-label", "aria-description", "alt", "label", "help", "info", "tooltip", "description"])
// Words that read the same in every language: names, units, symbols
const SAME_EVERYWHERE = /^(Owlit|owlit|PDF|PDFs|DOI|arXiv|BibTeX|Markdown|MinerU|OpenAlex|Semantic Scholar|Zotero|ACP|API|URL|ID|OK|Esc|Enter|Tab|Shift|Return|[⌘⇧⌥⌃↵⏎·•…—–\-+×/:#@,.()\s\d%]+)$/

const hasLetters = (text) => /\p{L}/u.test(text)

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (name === "node_modules") continue
    if (statSync(full).isDirectory()) yield* files(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

function check(file) {
  const text = readFileSync(file, "utf8")
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = text.split("\n")
  const found = []
  const ignored = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line
    return /i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "")
  }
  const report = (node, what) => {
    if (ignored(node)) return
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
    found.push(`${path.relative(root, file)}:${line + 1}:${character + 1}  ${what}`)
  }
  const insideTrans = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isJsxElement(n) && /^(Trans|Plural|Select|SelectOrdinal)$/.test(n.openingElement.tagName.getText(source))) return true
    }
    return false
  }
  // Inside a function, a class or a getter, a macro runs when it is called
  const atTopLevel = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false
    }
    return true
  }
  const MACROS = new Set(["t", "plural", "select", "selectOrdinal"])
  const visit = (node) => {
    const callee = ts.isTaggedTemplateExpression(node) ? node.tag : ts.isCallExpression(node) ? node.expression : null
    if (callee && ts.isIdentifier(callee) && MACROS.has(callee.text) && atTopLevel(node)) report(node, `${callee.text}(…) at the module's top level`)
    // t({ message, context }) and msg({ … }): the macro reads context and id only as written literals and
    // silently drops anything else, which merges messages meant to differ
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "msg"].includes(node.expression.text) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const p of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(p) && ["context", "id"].includes(p.name.getText(source)) && !ts.isStringLiteral(p.initializer) && !ts.isNoSubstitutionTemplateLiteral(p.initializer)) report(p, `${p.name.getText(source)} that isn't a literal string`)
      }
    }
    if (ts.isJsxText(node)) {
      const words = node.text.trim()
      if (words && hasLetters(words) && !SAME_EVERYWHERE.test(words) && !insideTrans(node)) report(node, `text "${words.slice(0, 60)}"`)
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source)
      let value = null
      if (ts.isStringLiteral(node.initializer)) value = node.initializer.text
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression && (ts.isStringLiteral(node.initializer.expression) || ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))) value = node.initializer.expression.text
      if (value !== null && WORDY_PROPS.has(name) && hasLetters(value) && !SAME_EVERYWHERE.test(value.trim())) report(node, `${name}="${value.slice(0, 60)}"`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["app/src", "apps/desktop/src", "apps/share-web/src", "packages/core/src"]
const problems = dirs.flatMap((dir) => [...files(path.resolve(root, dir))].flatMap(check))
if (problems.length) {
  console.error(`Words that would stay English (say them with t\`…\` or <Trans> where they show, or mark a name with i18n-ignore):\n${problems.join("\n")}`)
  process.exit(1)
}
