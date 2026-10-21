import { msg } from "@lingui/core/macro"
import { i18n } from "@/lib/i18n"

// The question other places start in Chat when they send the person there to find papers (Home, the
// Library, Threads): a stem in the interface's language the person goes on to write in, which title.ts
// strips by its words. "papers", not "recent papers": the framing work a section cites is often years
// old, and the stem becomes the chat's title.
export const FIND_STEM = msg({ message: "Find papers on ", comment: "starts a question the user finishes; keep the trailing space" })

export const findPrompt = () => i18n._(FIND_STEM)
