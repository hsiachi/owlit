// Files attached to chat messages: where owlit keeps its copies, and what kind of file each is. Shared so
// the window's chip and core's checks agree.

// What an agent may or may not be able to read. "word" covers Word and the other office formats (an agent
// reads them by unzipping), "other" any file that isn't text, a PDF or an image.
export type FileKind = "text" | "pdf" | "image" | "word" | "other"

const TEXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|tex|bib|ris|typ|rmd|qmd|org|rst|log|py|r|js|ts|tsx|jsx|sh|sql|ipynb|c|h|cpp|java|go|rs|rb|m|jl)$/i
const WORD = /\.(docx?|dotx|odt|rtf|pptx?|odp|xlsx?|ods|pages|numbers|key)$/i
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i

export function fileKindOf(name: string, mimeType = ""): FileKind {
  if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf"
  if (mimeType.startsWith("image/") || IMAGE.test(name)) return "image"
  if (WORD.test(name) || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(mimeType)) return "word"
  if (mimeType.startsWith("text/") || /json|xml|yaml/.test(mimeType) || TEXT.test(name)) return "text"
  return "other"
}

// How a chip names a kind it can't pass on: "Owlit engine can't read Word files"
export const FILE_KIND_NAMES: Record<FileKind, string> = {
  text: "text files",
  pdf: "PDFs",
  image: "images",
  word: "Word files",
  other: "this kind of file",
}

// A chat's copies of the files attached to it, relative to the workspace
export const chatFilesDir = (chatId: string) => `.owlit/chats/${chatId}/files`

// The chat whose copy this is, for a path relative to the workspace; null for any other path
export function chatOfFile(rel: string): string | null {
  return /^\.owlit\/chats\/([\w-]+)\/files\/[^/]+$/.exec(rel)?.[1] ?? null
}

// Files bigger than this are copied only after the user says so, once
export const LARGE_FILE_BYTES = 100 * 1024 * 1024
