// Each tag gets one of eight low-chroma hues, picked from its name so it stays the same
// everywhere it appears. Choosing a colour by hand can come later as an override.
const TAG_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const

type TagColor = (typeof TAG_COLORS)[number]

function tagColor(tag: string): TagColor {
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

// The dot's colour as a CSS value, for `style={{ backgroundColor }}`
export const tagColorVar = (tag: string) => `var(--tag-${tagColor(tag)})`

// How a tag is stored: lowercase, spaces as dashes ("Tool use" → "tool-use")
export const normalizeTag = (tag: string) => tag.trim().toLowerCase().replace(/\s+/g, "-")

// A paper's tags with the ones the list is narrowed to first, so a row that shows one tag and "+n" shows
// the tag the list is about rather than hiding it behind the count; otherwise in the paper's own order
export const tagsFirst = (tags: string[], filter: readonly string[]) =>
  filter.length ? [...tags.filter((t) => filter.includes(t)), ...tags.filter((t) => !filter.includes(t))] : tags
