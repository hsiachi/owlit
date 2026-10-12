// Markdown read as plain words: links, mentions and [[wikilinks]] keep their label; marks and line markers
// go. With `lines`, blocks stay one per line, as an editor that shows Markdown rich lays them out;
// otherwise the text is one run of words.
export function markdownPlain(md: string, { lines = false } = {}) {
  const text = md
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, label) => label ?? name)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ x]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*)[*_](?=\W|$)/g, "$1$2")
  return lines ? text.replace(/\n{2,}/g, "\n") : text.replace(/\s+/g, " ").trim()
}
