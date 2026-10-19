import { t } from "@lingui/core/macro"
import { NOTE_LANGUAGES, writesCjk, type DigestSource } from "@owlit/protocol"

// What a digest's header says it was written from, each only when it limits the reading: the text
// without the figures, fewer pages of text than the PDF has, a language other than the paper's
export function digestSourceNotes(source: DigestSource, pdfPages: number | undefined): string[] {
  const notes: string[] = []
  if (source.pictures === 0) notes.push(t`Read from the text only; figures not seen.`)
  const read = source.textPages
  if (read && pdfPages && read < pdfPages) notes.push(t`Pages 1–${read} of ${pdfPages}`)
  // The paper's language is known only by its script, so a digest is said to be in another language
  // only when the scripts differ (Chinese on an English paper, not German on an English one)
  if (source.language && source.cjkText !== undefined && writesCjk(source.language) !== source.cjkText) {
    const language = NOTE_LANGUAGES.find((l) => l.code === source.language)?.native ?? source.language
    notes.push(t({ message: `In ${language}`, comment: "the language a digest is written in, e.g. In 简体中文" }))
  }
  return notes
}
