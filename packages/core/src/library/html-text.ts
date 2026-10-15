// What the sources' XML and HTML say, as plain text: titles and names come with entities
// ("Information Processing &amp; Management"), and &amp; goes last so "&amp;lt;" stays "&lt;"
export const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")

// One space between words, and undefined for nothing at all
export const squash = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || undefined
