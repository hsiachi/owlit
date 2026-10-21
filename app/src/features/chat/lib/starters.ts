import type { MessageDescriptor } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { i18n } from "@/lib/i18n"
import type { SourceKind } from "@owlit/protocol"

// The Chat page is for longer work (a quick question goes through the agent window, ⌘J), so the
// starters are jobs that take a few minutes. Each fills a prompt stem; where it needs a paper or doc, the
// mention popup opens on that kind. Label and stem are both said in the interface's language: the stem
// starts the question the user goes on to write in it (title.ts strips it by its words). "Where did I
// stop?" is a whole question, sent as it is: Owlit reads what the user did (activity_read), the chats and
// the threads, and nothing in the app would otherwise suggest asking it.
export const starters: { id: string; label: MessageDescriptor; prompt: MessageDescriptor; kind?: SourceKind | "all" }[] = [
  { id: "find", label: msg`Find papers on a question`, prompt: msg({ message: "Find recent papers on ", comment: "starts a question the user finishes; keep the trailing space" }) },
  { id: "compare", label: msg`Compare papers`, prompt: msg({ message: "Compare the methods and findings of ", comment: "starts a question the user finishes with papers; keep the trailing space" }), kind: "paper" },
  { id: "review", label: msg`Review a draft`, prompt: msg({ message: "Review where I overstate a finding or misread a paper in ", comment: "starts a question the user finishes with a doc; keep the trailing space" }), kind: "doc" },
  { id: "ask", label: msg`Ask about your papers`, prompt: msg({ message: "What do my papers say about ", comment: "starts a question the user finishes; keep the trailing space" }) },
  {
    id: "resume",
    label: msg`Where did I stop?`,
    prompt: msg({
      message: "Where did I stop? Go project by project: what I last worked on, what waits on me, and what you proposed that still waits for my yes.",
      comment: "a whole question, sent as it is: Owlit accounts for each project from what the user did, the chats and the threads",
    }),
  },
]

// A starter's stem in the interface's language, for other places that start the same question
export const starterPrompt = (id: string) => i18n._(starters.find((s) => s.id === id)!.prompt)
