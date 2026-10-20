// A text's sha1 as hex, the hash core keeps for a doc's text (seen marks, the change log)
export async function sha1(text: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
