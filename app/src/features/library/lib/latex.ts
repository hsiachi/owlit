// Abstracts from arXiv and Crossref arrive with the authors' LaTeX in them: \textit{word}, $n$-gram,
// a \\ line break. Read as prose they only want the words, so this strips the common commands for display
// and leaves anything it doesn't know as it is (a stray macro reads better than a mangled sentence).

// Commands whose one argument is the text itself
const WRAPPERS = /\\(?:textit|textbf|texttt|textsc|textsf|textrm|textup|emph|underline|url|mbox|text)\s*\{([^{}]*)\}/g
// Characters LaTeX has to escape
const ESCAPES = /\\([%&_#$])/g

export function stripLatex(text: string): string {
  let out = text
  // Wrappers can nest (\textbf{\textit{x}}): each pass unwraps the innermost ones
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(WRAPPERS, "$1")
    if (next === out) break
    out = next
  }
  return (
    out
      // Inline math keeps its content: $n$-gram → n-gram, $O(n^2)$ → O(n^2)
      .replace(/\$\$([^$]+)\$\$/g, "$1")
      .replace(/\$([^$\n]+)\$/g, "$1")
      .replace(/\\\\\s*/g, "\n")
      .replace(ESCAPES, "$1")
      // A non-breaking space, and the empty group that ends a macro (\LaTeX{})
      .replace(/(^|[^\\])~/g, "$1 ")
      .replace(/\{\}/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  )
}
