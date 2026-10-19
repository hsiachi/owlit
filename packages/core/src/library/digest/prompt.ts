import { noteLanguageName, writesCjk, type PaperRecord } from "@owlit/protocol"
import type { FigureRecord } from "../figures/figures.ts"
import { digestInstructions } from "./instructions.ts"

// A digest: an agent reads the paper's full text (and sees its figures, when it can) and writes the
// note with library_write_digest, Markdown in a fixed shape (instructions.ts). The note is written
// once for every question to come, not for one: that is what makes it worth writing.

// The way notes are written now. A note written another way (an older owlit, pitta) is still a note;
// the paper page offers to rewrite it, and nothing rewrites it unasked.
export const DIGEST_FORMAT = 2

// What digest.json records beside digest.md
export interface DigestRecord {
  version: 1
  // Absent on notes from before formats were counted
  format?: number
  // Who wrote it: the agent's id ("claude-code"), or a chat for a note an agent kept itself
  by: string
  model?: string
  // The language it was asked for (a NOTE_LANGUAGES code or the user's words)
  language?: string
  // Some part came out in another language than asked (the Summary drifts most): kept, not refused
  drift?: boolean
  // How many of the paper's figures the agent saw as pictures (0: it read the text alone); absent on
  // digests from before it was counted
  pictures?: number
  at: number
}

// The full text given in the prompt; past it the agent reads on with library_read. pitta gave 400k;
// an agent's context also holds owlit's rules and tools, so a little less.
export const DIGEST_TEXT_LIMIT = 300_000

const FIELDS = ["Background", "Gap", "Research Question", "Methods", "Key Findings", "Limitations"]

// The last subsection's heading, in the note's language
function boundaryHeading(language: string) {
  if (language === "zh-Hans") return "结论的边界"
  if (language === "zh-Hant") return "結論的邊界"
  if (language === "en") return "The boundary of the conclusion"
  return `"The boundary of the conclusion", in ${noteLanguageName(language)}`
}

function languageRule(language: string) {
  const name = noteLanguageName(language)
  return `${name}. The prose, the ### headings and every explanatory sentence are in ${name}. Technical terms, method names, dataset names, measures and proper nouns stay exactly as the paper writes them, untranslated.`
}

// The recipe, and the paper's text that follows it: the chat that writes the digest keeps the recipe,
// and only where the text came from
export function digestPrompt(input: { id: string; record: PaperRecord; text: string; language: string; figures: FigureRecord[]; pictures: boolean }) {
  const { id, record, text, language, figures } = input
  const cut = text.length > DIGEST_TEXT_LIMIT
  const body = cut ? text.slice(0, DIGEST_TEXT_LIMIT) : text
  const instructions = digestInstructions({
    language: languageRule(language),
    title: record.title,
    fields: FIELDS.map((f) => `- **${f}**:`).join("\n"),
    // pitta's measure: an eighth of the paper, between 3,000 and 10,000 characters
    notes_budget: Math.min(10_000, Math.max(3_000, Math.floor(text.length / 8))),
    boundary: boundaryHeading(language),
  })
  const figureList = figures.length
    ? [
        "",
        "Figures and tables (id, page, caption):",
        ...figures.map((f) => `- ${f.id} (p. ${f.page + 1}): ${f.caption.slice(0, 300)}`),
        ...(input.pictures ? ["", "Their pictures are attached, each file named by its id. Look at the ones a finding may rest on before you write about them."] : []),
      ]
    : []
  const recipe = [
    instructions,
    "",
    `The paper is ${id} in the user's library. Write the note with library_write_digest, id ${id}: summary is everything under "## Summary" and details everything under "## Details", each without its heading; owlit adds the title "# ${record.title}" and the two headings. Then say in one short sentence that it is written. Don't add anything to the library and don't change anything else.`,
    "",
    `Title: ${record.title}`,
    `Authors: ${record.authors.join(", ") || "unknown"}`,
    `Published: ${record.year ?? "unknown"}`,
    ...figureList,
    "",
    "The full text of the paper, as parsed from its PDF, follows.",
  ].join("\n")
  return { recipe, text: cut ? `(The text is long: this is its first part. Read the rest with library_read, id ${id}, where the note needs it.)\n\n${body}` : body }
}

// Whether a part of the note left the language asked for: a ## or ### section of some length with
// almost no Chinese/Japanese/Korean characters in a note asked for in one of those. pitta saw it on one
// paper in twelve, always the Summary; the sound notes had 11–24%, so 5% leaves room for a section that
// is mostly numbers.
export function drifted(note: string, language: string) {
  if (!writesCjk(language)) return false
  const sections = note.split(/^#{2,3} /m).slice(1)
  return sections.some((s) => {
    const chars = s.replace(/\s/g, "")
    if (chars.length < 200) return false
    const cjk = chars.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0
    return cjk / chars.length < 0.05
  })
}
