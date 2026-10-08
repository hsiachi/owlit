// Each tag gets one of eight low-chroma hues, picked from its name so it stays the same
// everywhere it appears. Choosing a colour by hand can come later as an override.
const TAG_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const

export type TagColor = (typeof TAG_COLORS)[number]

export function tagColor(tag: string): TagColor {
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

// The dot's colour as a CSS value, for `style={{ backgroundColor }}`
export const tagColorVar = (tag: string) => `var(--tag-${tagColor(tag)})`
