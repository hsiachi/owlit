// The languages digests can be written in, picked in Settings. The setting holds a code from this
// list, or, for any other language, the user's own words for it, given to the agent as they are. Unset
// means the system's language when it is listed, English otherwise. Technical terms keep the paper's
// wording in every language; that is a rule of the note, not a setting.

export interface NoteLanguage {
  code: string
  // In English, for the agent
  name: string
  // In itself, for the picker
  native: string
}

export const NOTE_LANGUAGES: NoteLanguage[] = [
  { code: "en", name: "English", native: "English" },
  { code: "zh-Hans", name: "Simplified Chinese", native: "简体中文" },
  { code: "zh-Hant", name: "Traditional Chinese", native: "繁體中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "ru", name: "Russian", native: "Русский" },
]

export const DEFAULT_NOTE_LANGUAGE = "en"

const byCode = new Map(NOTE_LANGUAGES.map((l) => [l.code.toLowerCase(), l]))

// Words people typed before the setting was a list ("English", "Chinese", "中文") as the list's code;
// anything else stays the user's own words
const SPOKEN: Record<string, string> = {
  english: "en",
  chinese: "zh-Hans",
  中文: "zh-Hans",
  简体中文: "zh-Hans",
  "simplified chinese": "zh-Hans",
  繁體中文: "zh-Hant",
  繁体中文: "zh-Hant",
  "traditional chinese": "zh-Hant",
  japanese: "ja",
  日本語: "ja",
  korean: "ko",
  german: "de",
  french: "fr",
  spanish: "es",
  portuguese: "pt",
  italian: "it",
  russian: "ru",
}

export function normalizeNoteLanguage(value: string): string {
  const v = value.trim()
  return byCode.get(v.toLowerCase())?.code ?? SPOKEN[v.toLowerCase()] ?? v
}

// The list's language for the system's preferred languages (BCP 47, most preferred first): the first
// one listed. Chinese goes by script, which Taiwan and Hong Kong imply when only the region is given.
export function noteLanguageFor(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const lower = tag.toLowerCase()
    if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans"
    const base = lower.split("-")[0]
    if (byCode.has(base)) return byCode.get(base)!.code
  }
  return DEFAULT_NOTE_LANGUAGE
}

// How the agent is told the language: the English name and its own ("Simplified Chinese (简体中文)"),
// or the user's words for one that isn't listed
export function noteLanguageName(value: string): string {
  const known = byCode.get(value.toLowerCase())
  if (!known) return value
  return known.name === known.native ? known.name : `${known.name} (${known.native})`
}

// Languages written in Chinese characters or kana/hangul, whose share in a note shows it kept to them
export function writesCjk(value: string): boolean {
  return /^(zh|ja|ko)\b/i.test(value) || /[぀-ヿ㐀-鿿가-힯]/.test(value)
}
