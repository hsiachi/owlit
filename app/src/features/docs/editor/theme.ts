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

  // Headings sit after a blank line already, so they add only a little room of their own
  ".cm-doc-title": { fontSize: "22px", fontWeight: "500", lineHeight: "1.3", letterSpacing: "-0.015em", paddingBottom: "6px !important" },
  ".cm-h1": { fontSize: "18px", fontWeight: "600", lineHeight: "1.4", paddingTop: "6px !important" },
  ".cm-h2": { fontSize: "15px", fontWeight: "600", paddingTop: "4px !important" },
  ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { fontWeight: "600" },

  ".cm-mention": {
    color: "var(--mention)",
    borderRadius: "0.3em",
    padding: "0 0.2em",
    margin: "0 -0.2em",
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  ".cm-mention:hover": { backgroundColor: "color-mix(in oklch, var(--mention) 10%, transparent)" },
  ".cm-link": { textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "color-mix(in oklch, var(--foreground) 35%, transparent)" },
  ".cm-highlight": { backgroundColor: "color-mix(in oklch, var(--tag-amber) 30%, transparent)", borderRadius: "3px" },
  ".cm-inline-code": { fontFamily: mono, fontSize: "0.85em", backgroundColor: "var(--muted)", borderRadius: "4px", padding: "0.1em 0.3em" },

  ".cm-bullet": { display: "inline-block", width: "1ch", color: "var(--muted-foreground)" },
  ".cm-list-mark": { color: "var(--muted-foreground)" },
  ".cm-task": {
    display: "inline-block",
    width: "14px",
    height: "14px",
    marginRight: "4px",
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
  ".cm-hr": { position: "relative" },
  ".cm-hr::after": { content: '""', position: "absolute", left: "0", right: "0", top: "50%", borderTop: "1px solid var(--border)" },
  ".cm-hr-text": { color: "transparent" },

  ".cm-code": { fontFamily: mono, fontSize: "13px", backgroundColor: "var(--muted)", padding: "0 14px !important" },
  ".cm-code-first": { borderTopLeftRadius: "10px", borderTopRightRadius: "10px", paddingTop: "6px !important" },
  ".cm-code-last": { borderBottomLeftRadius: "10px", borderBottomRightRadius: "10px", paddingBottom: "6px !important" },
  ".cm-table": { fontFamily: mono, fontSize: "13px" },
  ".cm-frontmatter": { fontFamily: mono, fontSize: "13px", color: "var(--muted-foreground)" },

  // Floating pieces drawn by the editor take the menu look: popover surface, 10px corners, soft shadow
  ".cm-tooltip": { border: "none", backgroundColor: "transparent" },
  ".cm-selection-menu": {
    display: "flex",
    gap: "2px",
    padding: "3px",
    marginBottom: "6px",
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "0 2px 6px oklch(0.3 0.02 60 / 0.08), 0 12px 32px oklch(0.3 0.02 60 / 0.12)",
    fontFamily: "var(--font-sans, inherit)",
    fontSize: "13px",
  },
  ".cm-selection-menu button": { height: "28px", padding: "0 10px", borderRadius: "7px", color: "var(--foreground)", cursor: "default" },
  ".cm-selection-menu button:hover": { backgroundColor: "var(--accent)" },

  // An agent's proposed edit: removal is not an error, so it is struck through in the muted tone, not red
  ".cm-suggest-del": { color: "var(--muted-foreground)", textDecoration: "line-through" },
  ".cm-suggest-ins": { backgroundColor: "color-mix(in oklch, var(--success) 14%, transparent)", borderRadius: "3px", marginLeft: "0.25em" },
  ".cm-suggest-bar": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: "2px 0 10px",
    fontSize: "13px",
    lineHeight: "1.4",
    color: "var(--muted-foreground)",
  },
  ".cm-suggest-bar span": { flex: "1" },
  ".cm-suggest-bar button": { height: "28px", padding: "0 10px", borderRadius: "8px", cursor: "default" },
  ".cm-suggest-discard:hover": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
  ".cm-suggest-apply": { backgroundColor: "var(--primary)", color: "var(--primary-foreground)", fontWeight: "500" },
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
