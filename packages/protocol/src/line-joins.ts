// Joining lines of text pulled off a page back into prose, the same in the reader and in a paper's text.md

// A character of a script written without spaces between words (Han, kana), or the CJK punctuation and
// fullwidth forms set with it. Hangul is not one: Korean puts spaces between words.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u

// Whether text has any character of a script written without spaces
export const hasUnspaced = (text: string) => UNSPACED.test(text)

// What goes where a line ends and the next begins: nothing between two CJK characters (a line break in
// Chinese or Japanese is not a space), else one space. before and after: the text on either side, of
// which only the character next to the break counts.
export function lineJoint(before: string, after: string): "" | " " {
  // By code point: a Han character outside the BMP (Extension B on) is two UTF-16 units
  const last = [...before.slice(-2)].at(-1) ?? ""
  const first = after.codePointAt(0)
  return UNSPACED.test(last) && first !== undefined && UNSPACED.test(String.fromCodePoint(first)) ? "" : " "
}
