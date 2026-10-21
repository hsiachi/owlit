import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace"

// Body text is 15px in the reading column. The first line is the doc's title at page-title size; headings
// below it step down to 18px and 15px. Semibold appears only in headings and bold text.
export const docTheme = EditorView.theme({
  "&": { fontSize: "15px", color: "var(--foreground)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.7", overflow: "visible" },
  ".cm-content": { padding: "0 0 40vh", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "1.5px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },

  // The title outweighs every heading under it: the largest size and the headings' weight
  ".cm-doc-title": { fontSize: "22px", fontWeight: "600", lineHeight: "1.3", letterSpacing: "-0.015em", paddingBottom: "6px !important" },
  // Headings are sized by their #s (see live-preview): # and ## 18px, anything deeper 16px, a step over body
  // text so weight isn't all that sets them apart. Each sits after a blank line already; the extra room
  // above it, and the shrunken blank line below it, tie it to the text it heads.
  ".cm-h1": { fontSize: "18px", fontWeight: "600", lineHeight: "1.4", paddingTop: "12px !important" },
  ".cm-h2": { fontSize: "16px", fontWeight: "600", lineHeight: "1.5", paddingTop: "8px !important" },
  ".cm-heading-gap": { lineHeight: "8px" },

  ".cm-mention": {
    color: "var(--mention)",
    borderRadius: "0.3em",
    padding: "0 0.2em",
    margin: "0 -0.2em",
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  ".cm-mention:hover": { backgroundColor: "color-mix(in oklch, var(--mention) 10%, transparent)" },
  ".cm-mention[data-unread]": { color: "var(--color-mention-unread)" },
  // The citations a part of the doc's citations line names, while it is picked (lib/citations.ts)
  ".cm-mention[data-marked]": { backgroundColor: "color-mix(in oklch, var(--mention) 15%, transparent)" },
  ".cm-link": { textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "color-mix(in oklch, var(--foreground) 35%, transparent)" },
  ".cm-highlight": { backgroundColor: "var(--text-highlight)", borderRadius: "3px" },
  ".cm-inline-code": { fontFamily: mono, fontSize: "0.85em", backgroundColor: "var(--muted)", borderRadius: "4px", padding: "0.1em 0.3em" },

  // List items hang: the marker sits in a 1.5em box at the start of the first line, and the text, including
  // wrapped lines, starts after it. Each level of nesting steps in by one box.
  ".cm-line.cm-li": { paddingLeft: "calc(var(--li-depth) * 1.5em)", textIndent: "-1.5em" },
  ".cm-li *": { textIndent: "0" },
  ".cm-bullet": { display: "inline-block", width: "1.5em", paddingLeft: "0.3em", color: "var(--muted-foreground)" },
  ".cm-list-mark": { display: "inline-block", minWidth: "1.5em", color: "var(--muted-foreground)" },
  // The raw "-" shown while editing sits where the bullet was
  ".cm-list-dash": { paddingLeft: "0.3em", boxSizing: "border-box" },
  ".cm-task": {
    display: "inline-block",
    width: "14px",
    height: "14px",
    // The box and its gap fill the same 1.5em as a bullet
    marginRight: "calc(1.5em - 14px)",
    verticalAlign: "-2px",
    border: "1.5px solid color-mix(in oklch, var(--foreground) 35%, transparent)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  ".cm-task[data-checked]": {
    backgroundColor: "var(--primary)",
    borderColor: "var(--primary)",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E\")",
    backgroundSize: "100%",
  },
  ".cm-task-done": { color: "var(--muted-foreground)" },

  ".cm-quote": { borderLeft: "2px solid var(--border)", paddingLeft: "14px !important", color: "var(--muted-foreground)" },
  // A list inside a quote or callout hangs from the block's inset, not from the bar
  ".cm-line.cm-quote.cm-li, .cm-line.cm-callout.cm-li": { paddingLeft: "calc(14px + var(--li-depth) * 1.5em) !important" },
  ".cm-hr": { position: "relative" },
  ".cm-hr::after": { content: '""', position: "absolute", left: "0", right: "0", top: "50%", borderTop: "1px solid var(--border)" },
  ".cm-hr-text": { color: "transparent" },

  ".cm-code": { fontFamily: mono, fontSize: "13px", backgroundColor: "var(--muted)", padding: "0 14px !important" },
  ".cm-code-first": { borderTopLeftRadius: "10px", borderTopRightRadius: "10px", paddingTop: "6px !important" },
  ".cm-code-last": { borderBottomLeftRadius: "10px", borderBottomRightRadius: "10px", paddingBottom: "6px !important" },
  // A hidden fence leaves only a little room, and the opening one holds the language in the corner
  ".cm-code-fence": { lineHeight: "8px", position: "relative" },
  ".cm-code-lang": {
    position: "absolute",
    top: "6px",
    right: "14px",
    fontFamily: "var(--font-sans, inherit)",
    fontSize: "12px",
    lineHeight: "1.33",
    color: "var(--muted-foreground)",
  },
  ".cm-table": { fontFamily: mono, fontSize: "13px" },
  // A drawn table keeps the answer tables' ruled look; a little room above and below it. The editor wraps
  // lines with overflow-wrap: anywhere, which lets a table cell shrink to one letter ("Ben / chm / ark"),
  // so the table takes ordinary wrapping back: columns share the width by their content, none narrower than
  // its longest word, and a table that still can't fit scrolls sideways inside the doc
  ".cm-block-table": {
    padding: "4px 0 8px",
    fontSize: "14px",
    cursor: "text",
    overflowX: "auto",
    whiteSpace: "normal",
    wordBreak: "normal",
    overflowWrap: "break-word",
  },
  ".cm-block-table table": { margin: "0" },
  ".cm-block-math": { padding: "6px 0", textAlign: "center", overflowX: "auto", cursor: "text" },
  ".cm-math": { padding: "0 1px" },

  // A callout is a quiet tinted box; its label is a plain word, the title medium weight
  ".cm-callout": { backgroundColor: "var(--muted)", padding: "0 14px !important" },
  ".cm-callout-first": { borderTopLeftRadius: "10px", borderTopRightRadius: "10px", paddingTop: "8px !important" },
  ".cm-callout-last": { borderBottomLeftRadius: "10px", borderBottomRightRadius: "10px", paddingBottom: "8px !important" },
  ".cm-callout-label": { fontSize: "13px", fontWeight: "500", color: "var(--muted-foreground)", marginRight: "8px" },
  ".cm-callout-title": { fontWeight: "500" },

  // A [[wikilink]] that names no doc reads as a quiet, dotted promise of one
  ".cm-wikilink": { color: "var(--muted-foreground)", textDecoration: "underline dotted", textUnderlineOffset: "3px" },
  ".cm-embed": { fontSize: "13px", color: "var(--muted-foreground)", backgroundColor: "var(--muted)", borderRadius: "6px", padding: "1px 6px" },
  ".cm-frontmatter": { fontFamily: mono, fontSize: "13px", color: "var(--muted-foreground)" },
  ".cm-frontmatter-last": { paddingBottom: "12px !important" },
  // Away from the cursor, front matter is one 12px line of its fields above the title
  ".cm-frontmatter-folded": { paddingBottom: "12px", fontSize: "12px", lineHeight: "1.33", color: "var(--muted-foreground)", cursor: "text" },

  // Floating pieces drawn by the editor take the menu look: popover surface, 10px corners, soft shadow
  ".cm-tooltip": { border: "none", backgroundColor: "transparent" },
  // The selection menu and proposed edits are styled in index.css (.selection-menu, .suggest-*), shared
  // with the paper note
})

export const docHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.monospace, fontFamily: mono },
    // Marks that stay visible (while the cursor is on them, or in code and tables) read as quiet
    { tag: [t.processingInstruction, t.meta, t.url, t.contentSeparator], color: "var(--muted-foreground)" },
  ]),
)
