import type { JSONContent } from "@tiptap/core"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DocMention } from "@/features/docs/lib/mentions"
import { useWorkspace } from "@/lib/workspace"
import type { DraftFile } from "./lib/attachments"

// What was typed into a chat's composer and not sent yet. It waits with its chat while the person is
// elsewhere (another chat, another page, the panel closed), and never follows them into another chat. A
// chat has one draft wherever it is shown, on the Chat page or in the panel, and so does a new chat, in
// each workspace. The words outlast a restart; the files only last while the app runs, as their previews
// do (the copies stay in the chat's folder either way).
export interface ComposerDraft {
  doc?: JSONContent
  // Mentions that attaching made, which @ doesn't offer (the composer's extract finds them here)
  mentions: DocMention[]
  files: DraftFile[]
}

interface ComposerDraftsState {
  drafts: Record<string, ComposerDraft>
  // The id the next new chat starts with: files attached before sending are copied into its folder
  newId: string
  put: (key: string, next: Partial<ComposerDraft>) => void
  patchFiles: (key: string, change: (files: DraftFile[]) => DraftFile[]) => void
  // A mention for a draft that isn't in a composer just now (its file finished copying after the person
  // moved on): it goes at the end of the words
  append: (key: string, nodes: JSONContent[]) => void
  drop: (key: string) => void
  renew: () => void
}

const EMPTY: ComposerDraft = { mentions: [], files: [] }
export const NO_FILES: DraftFile[] = []

const withDraft = (drafts: Record<string, ComposerDraft>, key: string, draft: ComposerDraft) => {
  const { [key]: _old, ...rest } = drafts
  return draft.doc || draft.files.length ? { ...rest, [key]: draft } : rest
}

export const useComposerDrafts = create<ComposerDraftsState>()(
  persist(
    (set) => ({
      drafts: {},
      newId: crypto.randomUUID(),
      put: (key, next) => set((s) => ({ drafts: withDraft(s.drafts, key, { ...EMPTY, ...s.drafts[key], ...next }) })),
      patchFiles: (key, change) =>
        set((s) => {
          const draft = s.drafts[key] ?? EMPTY
          return { drafts: withDraft(s.drafts, key, { ...draft, files: change(draft.files) }) }
        }),
      append: (key, nodes) =>
        set((s) => {
          const draft = s.drafts[key] ?? EMPTY
          const blocks = [...(draft.doc?.content ?? [])]
          const last = blocks.pop() ?? { type: "paragraph" }
          blocks.push({ ...last, content: [...(last.content ?? []), ...nodes] })
          return { drafts: withDraft(s.drafts, key, { ...draft, doc: { type: "doc", content: blocks } }) }
        }),
      drop: (key) => set((s) => ({ drafts: withDraft(s.drafts, key, EMPTY) })),
      renew: () => set({ newId: crypto.randomUUID() }),
    }),
    {
      name: "owlit-composer-drafts",
      partialize: (s) => ({
        drafts: Object.fromEntries(
          Object.entries(s.drafts).flatMap(([key, d]) => (d.doc ? [[key, { doc: d.doc, mentions: d.mentions, files: NO_FILES }]] : [])),
        ),
      }),
    },
  ),
)

// The draft a composer shows: its chat's, or the new chat's for this workspace
export function useDraftKey(chatId: string | undefined) {
  const workspace = useWorkspace((s) => s.current?.path ?? "")
  return chatId ?? `new:${workspace}`
}
